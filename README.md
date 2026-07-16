# ひみつはめぐる

3〜8人で遊べる、オンライン推理カードゲームです。1枚だけの「ひみつ」がカード効果でプレイヤー間を移動し、現在の持ち主を「みぬく」で当てます。

## 起動

Node.js 20以降が必要です。

```powershell
npm.cmd install
npm.cmd run dev
```

- 画面: `http://localhost:5173`
- Socket.IOサーバー: `http://localhost:3002`

本番相当の起動:

```powershell
npm.cmd run build
npm.cmd start
```

`http://localhost:3002` から画面とSocket.IOを同一オリジンで配信します。

## 実装済み

- 3〜8人、1人4枚の人数別デッキ
- 全11種類のカードとサーバー側効果処理
- 6桁ルームコード、招待URL、QRコード
- ホスト設定、退出操作、ゲーム開始
- スマートフォン縦画面優先のレスポンシブUI
- サーバー権威のゲーム状態と、閲覧権限のある手札だけを返す個別状態
- ローカルストレージのトークンによる再接続
- 90秒の切断席保持
- ターン制限、公開ゲームログ、効果音、軽いバイブレーション
- 推理勝利、逃げ切り勝利、同じメンバーでの再戦、ロビー復帰

## テスト

```powershell
npm.cmd test
```

カード効果の単体テストに加え、3つのSocket.IOクライアントで参加、再接続、決着、再戦までを自動検証します。

## 構成

- `shared/cards.ts`: カード定義、人数別枚数、表示設定
- `server/src/game.ts`: UIから独立したゲームロジック
- `server/src/index.ts`: 部屋、Socket.IO、再接続、配信
- `client/src/App.tsx`: 画面と共通UIコンポーネント
- `client/src/styles.css`: CSS変数を含むデザイントークン
- `requirements.md`: 元の要件定義書
- `docs/assets-used.md`: 使用した既存キャラクター素材の記録

## Render

`render.yaml` を含めています。Nodeサービスとしてビルド・起動できます。無料プランではスリープ時にメモリ上の部屋が消えるため、継続運用では有料プランまたは外部ストアの追加を推奨します。
