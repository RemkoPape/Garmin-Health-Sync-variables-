/**
 * The names of the activities the sessions card shows, in the six languages. The key is the activity key of the note
 * (see activity-keys.ts); an activity that is not listed shows its key as readable text, so nothing is hidden.
 */
type Names = [en: string, de: string, es: string, fr: string, ja: string, zh: string];

const NAMES: Record<string, Names> = {
	running: ["Running", "Laufen", "Carrera", "Course à pied", "ランニング", "跑步"],
	trail_running: ["Trail running", "Trailrunning", "Trail running", "Course en sentier", "トレイルラン", "越野跑"],
	treadmill_running: ["Treadmill running", "Laufband", "Cinta de correr", "Tapis de course", "トレッドミル", "跑步机"],
	treadmill: ["Treadmill running", "Laufband", "Cinta de correr", "Tapis de course", "トレッドミル", "跑步机"],
	indoor_running: ["Indoor running", "Laufen in der Halle", "Carrera en interior", "Course en salle", "屋内ランニング", "室内跑步"],
	street_running: ["Street running", "Straßenlauf", "Carrera en calle", "Course sur route", "ロードラン", "路跑"],
	track_running: ["Track running", "Bahnlauf", "Carrera en pista", "Course sur piste", "トラックラン", "田径跑"],
	virtual_run: ["Virtual run", "Virtueller Lauf", "Carrera virtual", "Course virtuelle", "バーチャルラン", "虚拟跑步"],
	cycling: ["Cycling", "Radfahren", "Ciclismo", "Cyclisme", "サイクリング", "骑行"],
	road_biking: ["Road cycling", "Rennrad", "Ciclismo de carretera", "Vélo de route", "ロードバイク", "公路骑行"],
	mountain_biking: ["Mountain biking", "Mountainbike", "Ciclismo de montaña", "VTT", "マウンテンバイク", "山地骑行"],
	gravel_cycling: ["Gravel cycling", "Gravelbike", "Ciclismo gravel", "Vélo gravel", "グラベルバイク", "砾石骑行"],
	indoor_cycling: ["Indoor cycling", "Indoor-Radfahren", "Ciclismo indoor", "Vélo en salle", "インドアサイクリング", "室内骑行"],
	virtual_ride: ["Virtual ride", "Virtuelle Radfahrt", "Ruta virtual", "Sortie virtuelle", "バーチャルライド", "虚拟骑行"],
	e_bike: ["E-bike", "E-Bike", "Bici eléctrica", "Vélo électrique", "電動アシスト自転車", "电动自行车"],
	e_mtb: ["E-mountain bike", "E-Mountainbike", "Bici de montaña eléctrica", "VTT électrique", "電動マウンテンバイク", "电动山地车"],
	walking: ["Walking", "Gehen", "Caminata", "Marche", "ウォーキング", "步行"],
	indoor_walking: ["Indoor walking", "Gehen in der Halle", "Caminata en interior", "Marche en salle", "屋内ウォーキング", "室内步行"],
	hiking: ["Hiking", "Wandern", "Senderismo", "Randonnée", "ハイキング", "徒步"],
	mountaineering: ["Mountaineering", "Bergsteigen", "Montañismo", "Alpinisme", "登山", "登山运动"],
	rock_climbing: ["Rock climbing", "Klettern", "Escalada en roca", "Escalade", "ロッククライミング", "攀岩"],
	indoor_climbing: ["Indoor climbing", "Klettern in der Halle", "Escalada indoor", "Escalade en salle", "インドアクライミング", "室内攀岩"],
	bouldering: ["Bouldering", "Bouldern", "Búlder", "Bloc", "ボルダリング", "抱石"],
	lap_swimming: ["Pool swimming", "Schwimmen im Becken", "Natación en piscina", "Natation en piscine", "プール水泳", "泳池游泳"],
	pool_swimming: ["Pool swimming", "Schwimmen im Becken", "Natación en piscina", "Natation en piscine", "プール水泳", "泳池游泳"],
	swimming: ["Swimming", "Schwimmen", "Natación", "Natation", "水泳", "游泳"],
	open_water_swimming: ["Open water swimming", "Freiwasserschwimmen", "Natación en aguas abiertas", "Natation en eau libre", "オープンウォータースイム", "公开水域游泳"],
	strength_training: ["Strength training", "Krafttraining", "Entrenamiento de fuerza", "Musculation", "筋力トレーニング", "力量训练"],
	gym_equipment: ["Gym equipment", "Fitnessgeräte", "Máquinas de gimnasio", "Appareils de fitness", "ジム器具", "健身器械"],
	yoga: ["Yoga", "Yoga", "Yoga", "Yoga", "ヨガ", "瑜伽"],
	pilates: ["Pilates", "Pilates", "Pilates", "Pilates", "ピラティス", "普拉提"],
	hiit: ["HIIT", "HIIT", "HIIT", "HIIT", "HIIT", "高强度间歇训练"],
	cardio: ["Cardio", "Cardio", "Cardio", "Cardio", "カーディオ", "有氧运动"],
	indoor_cardio: ["Indoor cardio", "Cardio in der Halle", "Cardio en interior", "Cardio en salle", "屋内カーディオ", "室内有氧"],
	elliptical: ["Elliptical", "Crosstrainer", "Elíptica", "Elliptique", "エリプティカル", "椭圆机"],
	stair_stepper: ["Stair stepper", "Stepper", "Escaladora", "Stepper", "ステアステッパー", "登阶机"],
	stair_climbing: ["Stair climbing", "Treppensteigen", "Subir escaleras", "Montée d’escaliers", "階段昇降", "爬楼梯"],
	rowing: ["Rowing", "Rudern", "Remo", "Aviron", "ローイング", "划船"],
	indoor_rowing: ["Indoor rowing", "Rudern in der Halle", "Remo indoor", "Aviron en salle", "インドアローイング", "室内划船"],
	skiing: ["Skiing", "Skifahren", "Esquí", "Ski", "スキー", "滑雪"],
	cross_country_skiing: ["Cross-country skiing", "Langlauf", "Esquí de fondo", "Ski de fond", "クロスカントリースキー", "越野滑雪"],
	backcountry_skiing: ["Backcountry skiing", "Skitour", "Esquí de travesía", "Ski de randonnée", "バックカントリースキー", "野外滑雪"],
	snowboarding: ["Snowboarding", "Snowboarden", "Snowboard", "Snowboard", "スノーボード", "单板滑雪"],
	snowshoeing: ["Snowshoeing", "Schneeschuhwandern", "Raquetas de nieve", "Raquette", "スノーシュー", "雪鞋徒步"],
	kayaking: ["Kayaking", "Kajakfahren", "Kayak", "Kayak", "カヤック", "皮划艇"],
	paddling: ["Paddling", "Paddeln", "Paddle", "Pagayage", "パドリング", "划桨"],
	sup: ["Stand-up paddleboarding", "Stand-up-Paddling", "Paddle surf", "Paddle debout", "スタンドアップパドル", "立式桨板"],
	surfing: ["Surfing", "Surfen", "Surf", "Surf", "サーフィン", "冲浪"],
	sailing: ["Sailing", "Segeln", "Vela", "Voile", "セーリング", "帆船"],
	kiteboarding: ["Kiteboarding", "Kitesurfen", "Kitesurf", "Kitesurf", "カイトボード", "风筝冲浪"],
	windsurfing: ["Windsurfing", "Windsurfen", "Windsurf", "Planche à voile", "ウィンドサーフィン", "风帆冲浪"],
	tennis: ["Tennis", "Tennis", "Tenis", "Tennis", "テニス", "网球"],
	padel: ["Padel", "Padel", "Pádel", "Padel", "パデル", "板式网球"],
	pickleball: ["Pickleball", "Pickleball", "Pickleball", "Pickleball", "ピックルボール", "匹克球"],
	badminton: ["Badminton", "Badminton", "Bádminton", "Badminton", "バドミントン", "羽毛球"],
	squash: ["Squash", "Squash", "Squash", "Squash", "スカッシュ", "壁球"],
	table_tennis: ["Table tennis", "Tischtennis", "Tenis de mesa", "Tennis de table", "卓球", "乒乓球"],
	golf: ["Golf", "Golf", "Golf", "Golf", "ゴルフ", "高尔夫"],
	soccer: ["Soccer", "Fußball", "Fútbol", "Football", "サッカー", "足球"],
	basketball: ["Basketball", "Basketball", "Baloncesto", "Basket-ball", "バスケットボール", "篮球"],
	volleyball: ["Volleyball", "Volleyball", "Voleibol", "Volley-ball", "バレーボール", "排球"],
	rugby: ["Rugby", "Rugby", "Rugby", "Rugby", "ラグビー", "橄榄球"],
	hockey: ["Hockey", "Hockey", "Hockey", "Hockey", "ホッケー", "曲棍球"],
	ice_hockey: ["Ice hockey", "Eishockey", "Hockey sobre hielo", "Hockey sur glace", "アイスホッケー", "冰球"],
	cricket: ["Cricket", "Cricket", "Críquet", "Cricket", "クリケット", "板球"],
	boxing: ["Boxing", "Boxen", "Boxeo", "Boxe", "ボクシング", "拳击"],
	martial_arts: ["Martial arts", "Kampfsport", "Artes marciales", "Arts martiaux", "格闘技", "武术"],
	jump_rope: ["Jump rope", "Seilspringen", "Saltar la cuerda", "Corde à sauter", "縄跳び", "跳绳"],
	dancing: ["Dancing", "Tanzen", "Baile", "Danse", "ダンス", "舞蹈"],
	horseback_riding: ["Horseback riding", "Reiten", "Equitación", "Équitation", "乗馬", "骑马"],
	ice_skating: ["Ice skating", "Eislaufen", "Patinaje sobre hielo", "Patinage sur glace", "アイススケート", "滑冰"],
	inline_skating: ["Inline skating", "Inlineskaten", "Patinaje en línea", "Roller en ligne", "インラインスケート", "轮滑"],
	skating: ["Skating", "Skaten", "Patinaje", "Patin", "スケート", "滑行"],
	meditation: ["Meditation", "Meditation", "Meditación", "Méditation", "瞑想", "冥想"],
	breathwork: ["Breathwork", "Atemübung", "Respiración", "Respiration", "呼吸ワーク", "呼吸练习"],
	stretching: ["Stretching", "Dehnen", "Estiramientos", "Étirements", "ストレッチ", "拉伸"],
	mobility: ["Mobility", "Mobilität", "Movilidad", "Mobilité", "モビリティ", "灵活性训练"],
	multi_sport: ["Multisport", "Multisport", "Multideporte", "Multisport", "マルチスポーツ", "多项运动"],
	triathlon: ["Triathlon", "Triathlon", "Triatlón", "Triathlon", "トライアスロン", "铁人三项"],
	workout: ["Workout", "Training", "Entrenamiento", "Entraînement", "ワークアウト", "锻炼"],
};

const LANGUAGES = ["en", "de", "es", "fr", "ja", "zh"];

/** "mountain_biking" -> "Mountain biking": an activity without a name of its own. */
function readable(key: string): string {
	const words = key.replace(/_/g, " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The key of an activity without the suffix Garmin adds to some newer sports (`kayaking_v2`, `skate_skiing_ws`). */
export function stripGarminSuffix(key: string): string {
	return key.replace(/_(v2|ws)$/, "");
}

/** The name of an activity in a language. An activity without a name of its own, in any of the languages, shows its key as text. */
export function activityLabel(key: string, lang: string): string {
	const names = NAMES[stripGarminSuffix(key)];
	if (!names) return readable(stripGarminSuffix(key));
	return names[Math.max(0, LANGUAGES.indexOf(lang))]!;
}
