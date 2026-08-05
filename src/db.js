const mysql = require('mysql2/promise');
const { DATABASE_URL } = require('./config');

const pool = mysql.createPool(DATABASE_URL);

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invite_counts (
      guild_id   VARCHAR(32) NOT NULL,
      inviter_id VARCHAR(32) NOT NULL,
      count      INT NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, inviter_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invite_logs (
      id          BIGINT AUTO_INCREMENT PRIMARY KEY,
      guild_id    VARCHAR(32) NOT NULL,
      inviter_id  VARCHAR(32),
      invitee_id  VARCHAR(32) NOT NULL,
      invite_code VARCHAR(32),
      attribution_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
      attribution_reason VARCHAR(64),
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_guild_inviter (guild_id, inviter_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invite_owners (
      guild_id    VARCHAR(32) NOT NULL,
      invite_code VARCHAR(32) NOT NULL,
      owner_id    VARCHAR(32) NOT NULL,
      status      VARCHAR(16) NOT NULL DEFAULT 'active',
      used_at     DATETIME,
      invitee_id  VARCHAR(32),
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, invite_code)
    )
  `);

  // Safe, idempotent migration for databases created by earlier versions.
  const addedLogStatus = await addColumnIfMissing('invite_logs', 'attribution_status', "VARCHAR(32) NULL");
  await addColumnIfMissing('invite_logs', 'attribution_reason', 'VARCHAR(64) NULL');
  if (addedLogStatus) {
    await pool.query(`
      UPDATE invite_logs
      SET attribution_status = CASE WHEN inviter_id IS NULL THEN 'unknown' ELSE 'confirmed' END
      WHERE attribution_status IS NULL
    `);
    await pool.query(`
      ALTER TABLE invite_logs
      MODIFY COLUMN attribution_status VARCHAR(32) NOT NULL DEFAULT 'unknown'
    `);
  }

  // Links created by the old bot had no usage limit.  Keep their history, but
  // mark them as legacy so that they can never be attributed as a new invite.
  const addedOwnerStatus = await addColumnIfMissing('invite_owners', 'status', 'VARCHAR(16) NULL');
  await addColumnIfMissing('invite_owners', 'used_at', 'DATETIME NULL');
  await addColumnIfMissing('invite_owners', 'invitee_id', 'VARCHAR(32) NULL');
  if (addedOwnerStatus) {
    await pool.query(`
      UPDATE invite_owners SET status = 'legacy' WHERE status IS NULL
    `);
    await pool.query(`
      ALTER TABLE invite_owners
      MODIFY COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active'
    `);
  }
}

async function addColumnIfMissing(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (rows.length === 0) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    return true;
  }
  return false;
}

async function incrementInviteCount(guildId, inviterId) {
  await pool.query(
    `INSERT INTO invite_counts (guild_id, inviter_id, count)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE count = count + 1`,
    [guildId, inviterId]
  );
}

async function getInviteCount(guildId, inviterId) {
  const [rows] = await pool.query(
    `SELECT count FROM invite_counts WHERE guild_id = ? AND inviter_id = ?`,
    [guildId, inviterId]
  );
  return rows[0]?.count ?? 0;
}

async function logInvite({
  guildId,
  inviterId,
  inviteeId,
  inviteCode,
  attributionStatus,
  attributionReason,
}) {
  await pool.query(
    `INSERT INTO invite_logs
       (guild_id, inviter_id, invitee_id, invite_code, attribution_status, attribution_reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      guildId,
      inviterId,
      inviteeId,
      inviteCode,
      attributionStatus ?? (inviterId ? 'confirmed' : 'unknown'),
      attributionReason ?? null,
    ]
  );
}

async function saveInviteOwner(guildId, inviteCode, ownerId) {
  await pool.query(
    `INSERT INTO invite_owners (guild_id, invite_code, owner_id, status)
     VALUES (?, ?, ?, 'active')
     ON DUPLICATE KEY UPDATE
       owner_id = VALUES(owner_id), status = 'active', used_at = NULL, invitee_id = NULL`,
    [guildId, inviteCode, ownerId]
  );
}

async function getActiveOwnerInvite(guildId, ownerId) {
  const [rows] = await pool.query(
    `SELECT invite_code FROM invite_owners
     WHERE guild_id = ? AND owner_id = ? AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [guildId, ownerId]
  );
  return rows[0]?.invite_code ?? null;
}

async function markActiveInviteRevoked(guildId, inviteCode) {
  await pool.query(
    `UPDATE invite_owners SET status = 'revoked'
     WHERE guild_id = ? AND invite_code = ? AND status = 'active'`,
    [guildId, inviteCode]
  );
}

/**
 * Atomically consumes a panel-issued one-time invite.  Returning null means
 * that the link was not an active panel invite, or was already consumed.
 */
async function consumeAndRecordInvite(guildId, inviteCode, inviteeId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT owner_id FROM invite_owners
       WHERE guild_id = ? AND invite_code = ? AND status = 'active'
       FOR UPDATE`,
      [guildId, inviteCode]
    );
    const ownerId = rows[0]?.owner_id;
    if (!ownerId) {
      await connection.rollback();
      return null;
    }

    await connection.query(
      `UPDATE invite_owners
       SET status = 'used', used_at = CURRENT_TIMESTAMP, invitee_id = ?
       WHERE guild_id = ? AND invite_code = ?`,
      [inviteeId, guildId, inviteCode]
    );
    await connection.query(
      `INSERT INTO invite_counts (guild_id, inviter_id, count)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE count = count + 1`,
      [guildId, ownerId]
    );
    const [countRows] = await connection.query(
      `SELECT count FROM invite_counts WHERE guild_id = ? AND inviter_id = ?`,
      [guildId, ownerId]
    );
    const totalCount = countRows[0].count;
    await connection.query(
      `INSERT INTO invite_logs
         (guild_id, inviter_id, invitee_id, invite_code, attribution_status, attribution_reason)
       VALUES (?, ?, ?, ?, 'confirmed', 'panel_single_use')`,
      [guildId, ownerId, inviteeId, inviteCode]
    );
    await connection.commit();
    return { ownerId, totalCount };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function getLegacyInviteCodes(guildId) {
  const [rows] = await pool.query(
    `SELECT invite_code FROM invite_owners WHERE guild_id = ? AND status = 'legacy'`,
    [guildId]
  );
  return rows.map((row) => row.invite_code);
}

async function markInviteRevoked(guildId, inviteCode) {
  await pool.query(
    `UPDATE invite_owners SET status = 'revoked'
     WHERE guild_id = ? AND invite_code = ? AND status = 'legacy'`,
    [guildId, inviteCode]
  );
}

async function getInviteesByInviter(guildId, inviterId) {
  const [rows] = await pool.query(
    `SELECT invitee_id, created_at FROM invite_logs
     WHERE guild_id = ? AND inviter_id = ?
     ORDER BY created_at DESC`,
    [guildId, inviterId]
  );
  return rows;
}

async function getInviterOfInvitee(guildId, inviteeId) {
  const [rows] = await pool.query(
    `SELECT inviter_id, created_at FROM invite_logs
     WHERE guild_id = ? AND invitee_id = ?
     ORDER BY created_at DESC LIMIT 1`,
    [guildId, inviteeId]
  );
  return rows[0] ?? null;
}

module.exports = {
  pool,
  initSchema,
  incrementInviteCount,
  getInviteCount,
  logInvite,
  saveInviteOwner,
  getActiveOwnerInvite,
  markActiveInviteRevoked,
  consumeAndRecordInvite,
  getLegacyInviteCodes,
  markInviteRevoked,
  getInviteesByInviter,
  getInviterOfInvitee,
};
