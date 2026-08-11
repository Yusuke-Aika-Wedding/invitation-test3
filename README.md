# Yusuke & Aika Wedding Invitation

GitHub Pages + Google Apps Script + Googleスプレッドシートで動く、全ゲスト共通URLの結婚式Web招待状です。

## 公開URL

`https://Yusuke-Aika-Wedding.github.io/invitation-test3/`

ゲストは初回だけ招待状に記載されたIDを入力します。IDはスプレッドシート「ゲスト一覧」のA列と照合され、認証後は同じブラウザ・同じ端末で再入力する必要がありません。

## 主な機能

- 全員共通の招待状URL
- A列のIDによるゲスト認証・ゲスト名表示
- 認証済みIDの端末保存（Local Storage）
- 右上ハンバーガーメニュー
- 招待状ページ
- 内容が空の「2人の紹介ページ」
- 指定日時からメニューに現れる「本当の最後の謎ページ」
- スマホ・PC対応のレスポンシブデザイン
- フェード表示、桜の花びら、5秒ごとの写真スライド
- 結婚式までのカウントダウン
- 会場リンク、Googleマップ、行き方動画
- 挙式・披露宴の出欠フォーム
- アレルギー「あり／なし」必須選択と、「あり」の場合だけ表示される詳細欄
- GASによる回答保存、確認メール、リマインドメール、参加御礼メール

## フォルダ構成

```text
invitation-test3/
├─ index.html                 # 統一招待状ページ・ID入力画面
├─ 404.html                   # 統一URLへの戻り先
├─ css/style.css              # デザイン
├─ js/config.js               # GAS URL・時限公開日時などの設定
├─ js/script.js               # ID認証・画面切替・フォーム送信
├─ assets/                    # 添付ZIPから引き継いだ写真・動画
├─ gas/Code.gs                # GAS本体
├─ gas/appsscript.json        # GAS設定
└─ docs/SETUP_GUIDE.md        # 導入・更新手順
```

## 公開前に必要な作業

1. `gas/Code.gs` と `gas/appsscript.json` をGoogle Apps Scriptへ貼り付ける。
2. GASで `setup` を1回実行する。
3. GASをウェブアプリとしてデプロイする。
4. 発行されたURLを `js/config.js` の `gasWebAppUrl` に貼り付ける。
5. このフォルダの中身をGitHubリポジトリへアップロードする。

詳しくは `docs/SETUP_GUIDE.md` を参照してください。
