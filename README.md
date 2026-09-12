# DiscordBotClient Web

Botアカウントを、通常のDiscordユーザーアカウントのように操作できるWeb管理画面です。

- メッセージの送受信(リアルタイム)
- チャンネルの作成・編集・削除
- ロールの作成・削除・メンバーへの付与/剥奪
- メンバー一覧・キック・BAN

## 構成

```
[ブラウザ] ← サーバーに置いたHTML/CSS/JS (public/フォルダ)
    ↓ fetch / WebSocket
[バックエンド] ← Render や MWS など、Node.js常駐に対応したホスティング (server/フォルダ)
    ↓ REST / Gateway(WebSocket)
[Discord]
```

画面(フロントエンド)と、Discordと常時接続する頭脳部分(バックエンド)を分けています。
XREA Freeは常駐プロセスに対応していないため、バックエンドはRenderやMWSのような
Node.js常駐に対応したホスティングで動かす必要があります。

---

## 1. Discord Bot の準備

1. https://discord.com/developers/applications で Bot を作成
2. **Bot** タブで以下を有効化(必須)
   - `SERVER MEMBERS INTENT`
   - `MESSAGE CONTENT INTENT`
3. Botトークンを控えておく(あとでログイン画面に入力します)
4. OAuth2 URL Generator で `bot` スコープ、必要な権限(メッセージ管理・チャンネル管理・
   ロール管理・メンバーの追放・BANなど)にチェックして、生成されたURLからBotをサーバーに招待

---

## 2. バックエンドをデプロイ

バックエンド(`server/`一式)は普通のNode.jsアプリなので、常駐プロセス＆WebSocketに対応した
ホスティングであればどこでも動きます。以下は **Render** を使う場合の手順です
(MWSでもなんでも同じ`server/`の中身をそのまま使えます)。

### Renderにデプロイする場合

1. GitHubアカウントを持っていない場合は作成し、この`discord-bot-web`フォルダの中身を
   新しいリポジトリとしてアップロードする(GitHub上で「Add file → Upload files」でもOK)
2. https://render.com にアクセスし、GitHubアカウントでログイン
3. 「New +」→「Web Service」を選択し、先ほどのリポジトリを連携
4. 設定はほぼ自動検出されますが、念のため以下を確認
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free で問題ありません
5. 「Environment」タブで環境変数を追加
   - `APP_SECRET` に好きな文字列を設定(強く推奨)
   - `DISCORD_BOT_TOKEN` は空のままでOK(Web画面からログインする場合)
6. 「Create Web Service」でデプロイ開始。数分でビルドが完了し、
   `https://xxxxx.onrender.com` のようなURLが発行されます

この`render.yaml`ファイルが同梱されているので、Renderの「Blueprint」機能
(New + → Blueprint)を使えば、上記の設定が自動で読み込まれてさらに簡単です。

> **注意(無料プランの制限)**: Renderの無料プランは、一定時間アクセスが無いと
> スリープします。スリープ中はDiscordとのWebSocket接続も切れるため、
> リアルタイム受信を維持したい場合は有料プランへのアップグレードが必要になる場合があります。

### MWSにデプロイする場合

1. https://cloud.puratya.com/login からDiscordでログイン
2. 画面下のタブから **「Web」** を選ぶ(「Bot」タブではなく、公開URLが発行されるのはこちら)
3. 新しいWebサイトを作成し、言語は **Node.js** を選択
4. `server/` フォルダと `package.json` の中身をアップロード
5. 環境変数を設定
   - `APP_SECRET` に好きな文字列を設定しておくことを強く推奨します
   - `DISCORD_BOT_TOKEN` は空のままでOK
6. 起動ファイルは `server/index.js`(`package.json`ではなく直接指定するタイプの場合)
7. デプロイ後に発行されるURL(例: `https://xxxx.puratya.app`)を控えておく

ローカルで動作確認したい場合:

```bash
npm install
cp .env.example .env
npm start
# http://localhost:3000 にアクセス
```

---

## 3. フロントエンドをサーバーに設置

1. `public/` フォルダの中身(`index.html`, `style.css`, `app.js`)を、
   XREAのFTP/ファイルマネージャーで公開ディレクトリ(例: `public_html/`)にそのままアップロード
2. ブラウザで自分のXREAのURLを開く
3. ログイン画面で以下を入力
   - **バックエンドURL**: 手順2で控えたMWSのURL
   - **共有シークレット**: MWSで設定した `APP_SECRET`(設定していなければ空欄)
   - **Botトークン**: 手順1のBotトークン
4. 「ログイン」を押すと、サーバー一覧が表示されます

---

## セキュリティ上の注意

- Botトークンはブラウザには保存されません(ログインのたびに入力が必要です)。
  誤って他人にトークンが見えないよう扱いに注意してください。
- `APP_SECRET` を設定しない場合、バックエンドのURLさえ分かれば誰でもBotを操作できてしまいます。
  必ず設定することをおすすめします。
- このアプリは「Botアカウント」専用です。ユーザーアカウントのトークンを使う、
  いわゆる「セルフボット」はDiscordの利用規約違反のため対応していません。

## 主要ファイル

| ファイル | 役割 |
|---|---|
| `server/index.js` | Expressサーバー本体。REST APIエンドポイントを提供 |
| `server/discordRest.js` | Discord REST APIへのリクエスト処理 |
| `server/discordGateway.js` | DiscordとのWebSocket常時接続(リアルタイムイベント受信) |
| `server/wsHub.js` | ブラウザへイベントを中継する自前WebSocketサーバー |
| `public/index.html` | 画面のHTML |
| `public/style.css` | 見た目 |
| `public/app.js` | 画面側のロジック(API呼び出し・WebSocket受信) |

---

## テスト用公開環境
https://nuisancefang.jp/disbot
アクセスしてもらうとフロントエンドは公開していますので使用することができます
またフロントエンドサーバーを自分で立ち上げれないなど必要な方はDiscord(i8a_.)にてサポートを行なっています
