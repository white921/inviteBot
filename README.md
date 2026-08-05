# Discord 招待 Bot

新メンバーがサーバーに参加したとき「いつ・誰が・誰を招待したか」と「累計招待数」を指定チャンネルへ自動投稿する Discord Bot。

- パネル設置型: `/panel` で招待リンク発行パネルを設置 → メンバーはボタンを押して自分専用の**1回限り**リンクを取得
- パネル発行リンクだけを招待実績として確定記録。手動リンク・判定不能な参加は誤計上せず「不明」として保存
- 累計招待数は MySQL に永続化

## セットアップ

### 1. Discord Developer Portal

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリ作成 → Bot トークン取得
2. Bot タブで **Server Members Intent** を ON にする（Privileged Intent）
3. OAuth2 URL Generator で以下を選択し、生成された URL でサーバーに招待:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `View Channels`, `Send Messages`, `Embed Links`, `Create Invite`, `Manage Server`

### 2. チャンネル ID の設定

`src/constants.js` を編集し、以下を埋める:

```js
LOG_CHANNEL_ID: '...',          // 参加ログを投稿するチャンネル
INVITE_PANEL_CHANNEL_ID: '...', // パネルを設置するチャンネル（招待リンクの発行先も兼ねる）
```

ログ用とパネル用は **別チャンネル** にする。

### 3. ローカル起動

```bash
cp .env.example .env
# .env を編集して DISCORD_TOKEN / DISCORD_CLIENT_ID / DATABASE_URL を埋める
npm install
npm run deploy-commands   # スラッシュコマンドを Discord に登録（初回 / コマンド変更時）
npm start
```

### 4. Railway へデプロイ

1. Railway で新規プロジェクトを作成
2. MySQL プラグインを追加（`DATABASE_URL` が自動で注入される）
3. このリポを GitHub 経由でデプロイするか `railway up` で直接デプロイ
4. Variables に `DISCORD_TOKEN` と `DISCORD_CLIENT_ID` を追加
5. 初回のみ Railway の shell で `npm run deploy-commands` を実行

## 使い方

1. 管理者がサーバーで `/panel` を実行 → パネルが設置される
2. メンバーがパネルのボタンを押す → エフェメラルで自分専用の1回限り招待リンクが返る
3. 別のユーザーがそのリンクで参加 → `LOG_CHANNEL_ID` に「参加者 / 招待者 / 累計招待数」が投稿される
4. `/invites @user` で累計招待数を確認できる

## 仕組み

Discord API は `guildMemberAdd` で招待者を直接通知しない。Bot は起動時に各サーバーの全招待リンクの `uses` 数をキャッシュし、参加イベント発火時に再 fetch して変化したコードを特定する。パネル発行リンクは使用回数を1回に限定し、DB上で未使用であることまで確認できた場合だけ招待を確定する。

同時参加などで複数の招待リンクが同時に変化した場合、Discord APIだけでは参加者との対応を安全に決められない。その場合は誰の招待にも加算しない。これにより、誤った人の累計を増やさない。

この保証の対象はパネルから発行したリンクである。Discord標準機能で手動作成されたリンクはBot側で1回使用に強制できないため、集計対象外とする。

### 既存データの移行

初回起動時に既存の累計・参加履歴はそのまま保持される。旧版が発行した無制限リンクは `legacy` として移行され、起動時に失効される。各メンバーは必要に応じてパネルから新しい1回限りリンクを発行する。

## スキーマ

`db.js` 起動時に自動で作成:

- `invite_counts` — 招待者ごとの累計
- `invite_logs` — 個別の参加ログと、確定・不明の判定理由
- `invite_owners` — Bot 発行リンクの所有者対応表と、未使用・使用済み・移行済みの状態
