[English](README.md) · [Deutsch](README.de.md) · [中文](README.zh.md) · **日本語** · [Español](README.es.md) · [Français](README.fr.md)

# Garmin Health Sync

Garmin Connect から歩数、睡眠、心拍数、ストレス、アクティビティなどを自動的に Obsidian Daily Notes に同期します。Dataview で検索可能な frontmatter プロパティとして記録されます。

> **デスクトップとモバイルで動作します**（Windows、macOS、Linux、iOS、Android）。このプラグインは Garmin Connect の内部APIを使用します。公式のサードパーティAPIはありません。Garmin のメールアドレスとパスワード（2段階認証を使っている場合は確認コードも）でサインインします。Garmin がその試行をブロックした場合は、ブラウザでのサインインを代替手段として利用できます。

## 機能

- **起動時の自動同期** — 過去7日間をチェックし、欠落している健康データを補完
- **手動同期** — コマンドパレットから開いている Daily Note を同期
- **バックフィル** — 日付範囲の一括同期（例：過去3ヶ月分）
- **20以上の指標** — 歩数、睡眠スコア、HRV、ストレス、Body Battery、SpO2、体重など
- **アクティビティ追跡** — 各ワークアウトが読みやすいサマリーとして表示
- **ワークアウトの場所** — 最初の GPS アクティビティから逆ジオコーディングで取得した地名
- **スマート検出** — Periodic Notes または内蔵の Daily Notes プラグインから Daily Notes のパスとフォーマットを自動検出
- **サブディレクトリ対応** — ネストされたフォルダ内の既存 Daily Notes を検索（例：`Journal/2024-07/`）。ファイル名形式に `/` を含めると日付ごとのサブフォルダを作成（例：`YYYY/YYYY-MM-DD` → `Journal/2026/2026-08-04.md`）
- **言語自動検出** — UI 言語は Obsidian の言語設定に基づいて自動設定（EN、DE、ZH、JA、ES、FR）
- **オプションの構造化データ** — 高度な Dataview クエリ用の機械可読 `trainings` フィールド
- **ヘルスサイドパネル** — 回復・睡眠・エネルギー・活動・体力・トレーニングのカードを、あなた自身の普段の範囲と比べて表示する右サイドバー（オプション）。カードの電球をタップすると、データが示すことと計算方法が分かります。**設定 → Garmin Health Sync → サイドパネル**で有効にします
- **履歴ノート** — 取得した各日を月ごとの小さな Markdown ノートに保存できます（オプション）。デイリーノートがない日でもパネルが動作し、データは Vault と一緒に同期されます
- **デイリーノートのプロパティ** — ノートを開くときにプロパティブロックを折りたたむか、パネルがすでに表示している Garmin のプロパティを隠します

## Frontmatter 出力

### 指標

```yaml
---
steps: 15185
resting_hr: 69
sleep_score: 81
sleep_duration: 7h 43min
hrv: 39
stress: 30
vo2_max: 48
workout_location: Bad Honnef, Deutschland
---
```

**ボディバッテリー:** `body_battery` は Garmin の *charged* 値で、その日のボディバッテリー増加分の合計（主に睡眠中の回復）であり、現在のレベルではありません。その日の最低値と最高値（Garmin アプリの履歴に表示される値）が必要な場合は `body_battery_min` と `body_battery_max` を有効にしてください。

### アクティビティ

各ワークアウトはサマリー文字列を持つ frontmatter キーとして記録されます：

```yaml
---
hiking: 8.2 km · 157min · Ø105 bpm · 696 kcal
e_bike: 22.1 km · 65min · Ø112 bpm · 420 kcal
---
```

実際にワークアウトがあった日のみアクティビティキーが追加されます。プラグインはノートの既存コンテンツを上書きしません。

### トレーニング（オプション、機械可読）

設定で「機械可読トレーニング」を有効にすると、Dataview クエリ用の構造化 `trainings` フィールドが追加されます：

```yaml
---
trainings:
  - type: hiking
    category: outdoor
    distance_km: 8.2
    duration_min: 157
    avg_hr: 105
    calories: 696
  - type: e_bike
    category: cycling
    distance_km: 22.1
    duration_min: 65
    avg_hr: 112
    calories: 420
---
```

## 要件

- **Obsidian**（Windows、macOS、Linux、iOS、Android）
- Garmin Connect にアクセスできる **Garmin アカウント**
- **Daily Notes** または **Periodic Notes** プラグインが有効（または設定でパスを手動指定）

## インストール

### Community Plugins から（推奨）

1. Obsidian 設定 → Community Plugins → ブラウズ を開く
2. "Garmin Health Sync" を検索
3. プラグインをインストールして有効化
4. プラグイン設定で Garmin Connect にログイン

### 手動インストール

1. [最新リリース](https://github.com/davadev/Garmin-Health-Sync/releases)から `main.js` と `manifest.json` をダウンロード
2. Vault 内に `.obsidian/plugins/garmin-health-sync/` フォルダを作成
3. 両方のファイルをそのフォルダにコピー
4. 設定 → Community Plugins でプラグインを有効化

## 使い方

### サインイン

プラグインの設定を開き、**Garmin Connect** を選んで、Garmin のメールアドレスとパスワード（2段階認証を使っている場合は確認コードも）を入力します。デスクトップでもモバイルでも同じ方法でサインインできます。

Garmin は同じデバイスからの繰り返しのサインイン試行を制限することがあります。その場合、プラグインは次に試せるまでのカウントダウンを表示します。サインインがブロックされたときは、代わりに**ブラウザでサインイン**を使ってください。ブラウザで Garmin のページにサインインし、`ST-…` を含むページのテキストをコピーして、プラグインのクリップボードボタンをタップします（入力欄に貼り付けることもできます）。一度サインインすれば、プラグインが自動で接続を更新するため、再サインインが必要になることはほとんどありません。

### ノートの保存場所

**デイリーノートのパス**がフォルダ、**デイリーノートの形式**が [moment.js](https://momentjs.com/docs/#/displaying/format/) 構文によるファイル名で、標準の Daily Notes プラグインと同じ規則です。形式自体に `/` を含めると日付ごとのサブフォルダに配置でき、角かっこ内の文字列はそのまま使われます:

| パス | 形式 | 結果 |
| --- | --- | --- |
| `Journal` | `YYYY-MM-DD` | `Journal/2026-08-04.md` |
| `Journal` | `YYYY/YYYY-MM-DD` | `Journal/2026/2026-08-04.md` |
| `Journal` | `YYYY/YYYY-MM/YYYY-MM-DD` | `Journal/2026/2026-08/2026-08-04.md` |
| `Journal` | `YYYY-MM-DD [Workout]` | `Journal/2026-08-04 Workout.md` |

存在しないサブフォルダは自動的に作成されます。

### 自動同期

Obsidian 起動時に、プラグインが過去7日間をチェックし、欠落している健康データを自動で補完します。操作は不要です。既定では、デイリーノートが無い場合は自動的に作成します。

他のツールがデイリーノートを管理している場合（Templater、Calendar プラグイン、外部同期など）は、設定の **デイリーノートがない日** を **その日をスキップ** にしてください。自動同期は実体のある（空でない）デイリーノートが存在するまで待機し、現れた時点で同期します。0 バイトの空のプレースホルダーは無視されます。**履歴ファイルに保存** にすると、ノートがない日にはノートを作成せず、その日を履歴ノートに保存します（下記参照）。手動同期は常に開いているノートに書き込みます。

### 手動同期

Daily Note を開き、コマンドパレット（Cmd/Ctrl+P）から **Garmin Health Sync: Sync current note** を実行します。

### 過去データのバックフィル

長年の Garmin データがありますか？任意の日付範囲を一括同期できます：

1. コマンドパレット（Cmd/Ctrl+P）を開く
2. **「ヘルスデータをバックフィル」** を検索
3. 開始日と終了日を選択
4. プラグインが API スロットリングを避けながら、その範囲のすべてのデータを取得し、処理中の日と残り時間を表示します

以前のバックフィルで、有効なすべての指標を取得済みの日はスキップされます（まだ変わる可能性がある直近3日を除く）。**ヘルスデータをもう一度バックフィル（取得済みを無視）** は、すべての日をもう一度取得して値を上書きします。デイリーノートがない日の扱いは **デイリーノートがない日** の設定に従います。

### ヘルスサイドパネル

プラグイン設定で **サイドパネル** をオンにし、リボンのアイコンまたはコマンド **ヘルスパネルを開く** で開きます。カードは今日をあなた自身の普段の範囲（過去30日）と比べ、ノートを変更することはありません。日付をタップして日を選び、矢印で1日ずつ移動し、鉛筆ボタンでカードをドラッグして並べ替えられます。各カードには設定にスイッチがあり、そのカードに必要な指標も表示されます。カードの電球をタップすると、**データから分かること**（あなた自身のデータに基づく理由と対策）と **見方** が表示されます。パネルは医療上のアドバイスではありません。設定で生年（年のみ）を入力すると、心拍ゾーンと年齢に応じた目標が使えます。

<p>
<img src="docs/screenshots/panel-today.png" width="280" alt="レディネスと回復">
<img src="docs/screenshots/panel-today-dark.png" width="280" alt="同じカードのダークテーマ表示">
<img src="docs/screenshots/panel-insights.png" width="280" alt="電球の下に表示されるデータからの示唆">
<img src="docs/screenshots/panel-hydration.png" width="280" alt="解説付きの水分補給カード">
<img src="docs/screenshots/panel-sleep.png" width="280" alt="睡眠と睡眠ステージ">
<img src="docs/screenshots/panel-energy.png" width="280" alt="ボディバッテリー、ストレス、水分補給">
<img src="docs/screenshots/panel-training.png" width="280" alt="歩数、負荷バランス、週間負荷、セッション">
</p>

### 履歴ノートと Garmin履歴の作成

**デイリーノートがない日** を **履歴ファイルに保存** にすると、取得した各日がデイリーノートのフォルダ内の月ごとの小さなノート（`Garmin history/Garmin history 2026-10.md`、1日1行）にも保存されます。通常の Markdown なので Vault と一緒に同期され、パネルはノートがない日にこれを読みます。コマンド **デイリーノートから履歴を取り込む** は、既存のノートの Garmin の値を履歴にコピーします。**Garmin履歴を作成** は、選んだ日付（既定は5年前）まで新しい日から順に取得します。必要な時間を表示し、停止しても続きから再開でき、Garmin が応答しないときは待って再試行し、すでにある日はスキップします。デイリーノートのフォルダを変更すると、履歴ノートも一緒に移動します。

### デイリーノートのプロパティ

**デイリーノートのプロパティ** の設定では、デイリーノートを開くときにプロパティブロックを折りたたむ、プラグインが書き込んだプロパティ（パネルが表示します）を隠す、またはその両方を選べます。ノートから何も削除されません。

## アクティビティキーの正規化

Garmin の `typeKey` 値はより簡潔な正規キーに変換されます：

| プロバイダーキー | 正規キー | カテゴリ |
|---|---|---|
| `e_bike_fitness` | `e_bike` | cycling |
| `e_bike_mountain` | `e_mtb` | cycling |
| `resort_skiing_snowboarding` | `skiing` | winter |
| `backcountry_skiing_snowboarding` | `backcountry_skiing` | winter |
| `stand_up_paddleboarding` | `sup` | water |
| `fitness_equipment` | `gym_equipment` | gym |

その他の Garmin キーはそのまま使用されます（例：`hiking`、`running`、`cycling`、`swimming`、`strength_training`、`yoga` など）。

### アクティビティカテゴリ

各アクティビティにはカテゴリが割り当てられます：

| カテゴリ | 例 |
|---|---|
| `cycling` | cycling, e_bike, e_mtb, mountain_biking, indoor_cycling, road_biking |
| `running` | running, trail_running, treadmill, ultra_run |
| `walking` | walking, indoor_walking |
| `outdoor` | hiking, mountaineering, rock_climbing, bouldering |
| `swimming` | swimming, pool_swimming, open_water_swimming |
| `winter` | skiing, backcountry_skiing, cross_country_skiing, snowboarding |
| `water` | sup, rowing, kayaking, surfing, sailing |
| `gym` | strength_training, gym_equipment, elliptical, yoga, pilates, hiit |
| `racket` | tennis, badminton, squash, table_tennis, pickleball |
| `team` | soccer, basketball, volleyball, rugby |
| `other` | golf, meditation, multi_sport |

## データとプライバシー

このプラグインは、2つの外部サービスへネットワークリクエストを行います。

- **Garmin Connect** — プラグインにメールアドレスとパスワード（必要な場合は確認コードも）を入力します。これらは Garmin のサインインサーバー（`sso.garmin.com`、中国向けは `sso.garmin.cn`）にのみ送信され、プラグインが保存したりログに記録したりすることはありません。サインイン後、プラグインは Garmin のサインイントークンを Obsidian のシークレットストレージに保存します。これはデバイス内に留まるため、他のデバイスへの同期や、Vault のバックアップ・Git への混入は起こりません。シークレットストレージが利用できない場合や書き込みが拒否された場合に限り、`data.json` に保存します。これらのトークンはログイン情報と同様に扱ってください。有効期間は Garmin が管理します。各デバイスで個別にサインインします。Garmin がサインインをブロックまたは制限した場合は、ブラウザでのサインインが提示されます（ブラウザで Garmin のページにサインインし、1回限りのチケットを貼り付けます）。サインインに必要な公開 OAuth クライアントキーは `thegarth.s3.amazonaws.com` から取得します（このホストに接続できない場合は同梱のフォールバックキーを使用）。**ログアウト**でこのデバイスに保存されたトークンを削除します。
- **Nominatim (OpenStreetMap)** — **ワークアウト場所**機能が有効な場合、最初のアクティビティのGPS座標が逆ジオコーディングのために `nominatim.openstreetmap.org` に送信されます。設定の **ワークアウト場所** で無効にできます。

その他のサーバーにデータは送信されません。

**履歴ノート：** オプションの履歴ノートにはあなたの健康値が含まれ、デイリーノートと同様に Vault 内にあります。そのためにプラグインが追加のネットワークリクエストを行うことはありません。

**クリップボード：** プラグインがクリップボードを使うのは、ボタンをタップしたときだけで、バックグラウンドでは使いません。**ブラウザでサインイン**は、**クリップボードからログイン**をタップしたときに1回だけ読み取り、ブラウザでコピーした1回限りのサインインチケットを取得します。サインインリンクをコピーするとき、または**診断情報をコピー**（設定とサインイン画面）をタップしたときに書き込みます。診断にはパスワード、トークン、アカウント情報、健康データの値は含まれず、直近のサインインまたは同期の技術情報（データ種別名、HTTP ステータスコード、応答サイズ、所要時間）のみが含まれます。

## 開発

```bash
npm install
npm run dev    # ウォッチモード
npm run build  # プロダクションビルド
```

## クレジット

[fcandi](https://github.com/fcandi) が作成したプラグインです。現在は [davadev](https://github.com/davadev) がメンテナンスと開発を行っています。
