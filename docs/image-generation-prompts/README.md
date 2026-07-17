# ビジュアル生成プロンプト

今回のビジュアル全面刷新で使用した生成方針と、再生成用プロンプトの記録です。参照画像は `public/assets/characters/references/` の各キャラクター資料を使用します。

## 共通アートディレクション

```text
Preserve the exact character identity, silhouette, face, clothing and signature colors from the supplied reference image. Create a new game-specific illustration, not a crop or reuse of the reference artwork. Cute Japanese card-game art with bold clean outlines, simple cel shading, clearly separated flat colors and one small hard-edged cast shadow. Cream paper background with a restrained teal, violet and warm-gold palette. No text, letters, numbers, speech bubbles, logos or watermark. No gradient, blur, watercolor, glow, noise or painterly texture. Keep the expression readable at icon size.
```

生成後はPNGへ書き出し、色数を抑えるためにポスタライズ処理を行っています。カード絵は640×640・最大24色、アイコンは512×512・最大20色、ページ絵は用途別サイズ・最大24〜40色です。

## カード専用イラスト（640×640）

共通アートディレクションに、以下の個別構図を追加して生成します。

| ファイル | 個別プロンプト |
|---|---|
| `secret.png` | Wolf character guarding one mysterious violet card close to the chest, alert but gentle expression, a single small star symbol on the card, centered composition. |
| `deduce.png` | Tanuki character confidently pointing toward one of three face-down violet cards, focused detective-like gaze, one simple star marker, clear left-to-right decision composition. |
| `peek.png` | Sheep character quietly peeking from behind one upright violet card, only part of the face visible, curious expression, small sparkle accents. |
| `swap.png` | Tanuki character holding two different cards while crossing the hands to show a secret exchange, compact diagonal motion marks. |
| `share.png` | Hamster character offering a violet card forward with both paws like a friendly present, warm open expression. |
| `rotate.png` | Penguin character turning as three violet cards travel around in a clear circular loop, bold directional arrows. |
| `rumor.png` | Sheep character whispering while two small translucent candidate silhouettes appear beside a real card, gentle information-sharing pose. |
| `decoy.png` | Tanuki character partly hidden behind a leafy screen while presenting a harmless dummy card, playful defensive expression. |
| `observe.png` | Wolf character studying a spread of cards with a small handheld magnifier, calm concentrated expression. |
| `again.png` | Penguin character stepping forward energetically for a second action, one card in hand and a bold repeat arrow behind. |
| `chaos.png` | All five reference characters reacting as several violet cards fly and cross in a controlled swirl, lively but readable ensemble composition. |

`secret.png`、`deduce.png`、`peek.png` は初回生成で疑問符が混入したため、次の編集指示で再生成しました。

```text
Keep the entire illustration unchanged except replace every question-mark symbol with one simple four-point star. Do not add any text or other symbol.
```

## プレイヤーアイコン（512×512）

各キャラクターの参照画像を1体ずつ与え、共通アートディレクションに以下を追加します。

```text
Front-facing centered bust portrait for a circular player icon. Calm friendly expression, face large in frame, shoulders fully visible, solid pale mint or cream circular background, generous safe area around ears and hair. No props, no card text, no speech bubble.
```

出力先は `public/assets/characters/icons/{sheep|hamster|tanuki|wolf|penguin}.png` です。

## ページ用ビジュアル

### トップ `pages/top/hero.png`（1600×900）

```text
Using all five supplied character references, compose the five characters in a clockwise circle passing small violet mystery cards from one to the next. Sheep is near the center, hamster upper-left, tanuki upper-right, wolf lower-left and penguin lower-right. Add sparse leaves, tiny four-point stars and simple directional arrows. Wide 16:9 cream-paper key visual, clear empty margins, no text.
```

### ロビー `pages/lobby/waiting.png`（960×720）

```text
Sheep character sitting patiently beside a small neat stack of face-down violet cards, looking toward an empty space as if waiting for friends. A few leaves and tiny star accents, calm cream background, no text.
```

### 遊び方 `pages/help/guide.png`（960×640）

```text
Sheep character presenting a simple clockwise loop made of three face-down violet cards and clear arrows. Educational, welcoming composition with large readable shapes and empty cream background, no text.
```

### ゲーム装飾 `pages/game/table-border.png`（1600×800）

```text
Wide transparent-feeling table-edge decoration for a card game UI. Place several face-down violet cards, simple curved arrows, leaves and four-point stars only along the far left and right edges. Keep the entire central 70 percent empty so UI panels remain readable. Cream paper base, no characters, no text.
```
