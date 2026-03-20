<?php
/**
 * Template Name: VT Role Index
 * Template Post Type: page
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$current_lang = function_exists( 'pll_current_language' ) ? (string) pll_current_language( 'slug' ) : 'zh';

function vtportal_page_url_by_template_for_lang( $template, $lang = '' ) {
	$template = trim( (string) $template );
	$lang     = sanitize_title( (string) $lang );
	if ( '' === $template ) {
		return '';
	}

	$q = new WP_Query(
		[
			'post_type'              => 'page',
			'post_status'            => 'publish',
			'posts_per_page'         => 1,
			'orderby'                => 'ID',
			'order'                  => 'ASC',
			'fields'                 => 'ids',
			'suppress_filters'       => true,
			'no_found_rows'          => true,
			'update_post_meta_cache' => false,
			'update_post_term_cache' => false,
			'meta_query'             => [
				[
					'key'   => '_wp_page_template',
					'value' => $template,
				],
			],
		]
	);

	$base_id = intval( $q->posts[0] ?? 0 );
	if ( $base_id <= 0 ) {
		return '';
	}

	if ( function_exists( 'pll_get_post_translations' ) && '' !== $lang ) {
		$map = pll_get_post_translations( $base_id );
		$tid = intval( is_array( $map ) ? ( $map[ $lang ] ?? 0 ) : 0 );
		if ( $tid > 0 ) {
			$u = get_permalink( $tid );
			if ( is_string( $u ) && '' !== $u ) {
				return $u;
			}
		}
	}

	$u = get_permalink( $base_id );
	return is_string( $u ) ? $u : '';
}

function vtportal_url_with_lang( $path, $lang = '' ) {
	$path = '/' . ltrim( (string) $path, '/' );
	$lang = sanitize_title( (string) $lang );

	$special_pages = [
		'/platforms/'   => 'vt-platform-index.php',
		'/agencies/'    => 'vt-agency-index.php',
		'/countries/'   => 'vt-country-index.php',
		'/debut-years/' => 'vt-debut-year-index.php',
		'/roles/'       => 'vt-role-index.php',
		'/contact/'     => 'vt-contact.php',
	];
	$path_key      = '/' . trim( $path, '/' ) . '/';
	if ( isset( $special_pages[ $path_key ] ) ) {
		$special = vtportal_page_url_by_template_for_lang( $special_pages[ $path_key ], $lang );
		if ( '' !== $special ) {
			return $special;
		}
	}

	if ( '' === $lang || 'zh' === $lang ) {
		return home_url( $path );
	}
	$allowed = [ 'cn', 'ja', 'en', 'ko', 'es', 'hi' ];
	if ( ! in_array( $lang, $allowed, true ) ) {
		return home_url( $path );
	}
	return home_url( '/' . $lang . $path );
}

function vtportal_archive_url_for_lang( $post_type, $lang = '' ) {
	$obj  = get_post_type_object( $post_type );
	$slug = isset( $obj->rewrite['slug'] ) ? (string) $obj->rewrite['slug'] : $post_type;
	return vtportal_url_with_lang( '/' . trim( $slug, '/' ) . '/', $lang );
}

function vtportal_role_copy( $lang = 'zh' ) {
	$copy = [
		'zh' => [
			'title'         => '依風格 / 個性瀏覽 VTuber',
			'intro_1'       => '以風格、內容類型與人格特徵聚合條目，快速找到相似 VTuber。',
			'intro_2'       => '此頁是主題型 SEO 集合頁，適合從「歌回型、雜談型、遊戲實況型」等關鍵字進站。',
			'card_prefix'   => '收錄',
			'card_suffix'   => '位 VTuber',
			'empty'         => '目前尚無可用的風格標籤資料。',
			'eyebrow'       => '主題集合頁',
			'related'       => '相關集合頁',
			'faq_title'     => '常見問題',
			'faq_q1'        => '這頁是做什麼的？',
			'faq_a1'        => '這是依風格與個性分類的 VTuber 集合頁，讓使用者可用主題方式探索，不只靠姓名搜尋。',
			'faq_q2'        => '這些標籤會更新嗎？',
			'faq_a2'        => '會。maintain 流程會定期重建標籤關聯、排除雜訊標籤，並同步更新集合頁內容。',
		],
		'cn' => [
			'title'         => '按风格 / 个性浏览 VTuber',
			'intro_1'       => '按风格、内容类型与个性特征聚合条目，快速找到相似 VTuber。',
			'intro_2'       => '此页为主题型 SEO 集合页，适合从“唱歌型、杂谈型、游戏型”等关键词进入。',
			'card_prefix'   => '收录',
			'card_suffix'   => '位 VTuber',
			'empty'         => '目前暂无可用的风格标签数据。',
			'eyebrow'       => '主题集合页',
			'related'       => '相关集合页',
			'faq_title'     => '常见问题',
			'faq_q1'        => '这个页面是做什么的？',
			'faq_a1'        => '这是按风格和个性分类的 VTuber 集合页，用户可以用主题方式探索，不只靠名字搜索。',
			'faq_q2'        => '这些标签会更新吗？',
			'faq_a2'        => '会。maintain 流程会定期重建标签关联、排除噪音标签，并同步更新集合页内容。',
		],
		'ja' => [
			'title'         => 'スタイル / 個性でVTuberを探す',
			'intro_1'       => '配信スタイル、内容タイプ、キャラクター性でまとめて、似たVTuberを素早く見つけられます。',
			'intro_2'       => 'このページはテーマ型SEOハブとして設計され、検索流入と内部リンクの強化に使われます。',
			'card_prefix'   => '掲載',
			'card_suffix'   => '名',
			'empty'         => '利用可能なスタイルタグがまだありません。',
			'eyebrow'       => 'テーマハブ',
			'related'       => '関連ハブ',
			'faq_title'     => 'よくある質問',
			'faq_q1'        => 'このページの目的は？',
			'faq_a1'        => 'スタイルや個性別にVTuberを整理し、名前検索以外の導線を提供するためのページです。',
			'faq_q2'        => 'タグは更新されますか？',
			'faq_a2'        => 'はい。maintainフローでタグ関係を定期更新し、ノイズタグを除外します。',
		],
		'en' => [
			'title'         => 'Browse VTubers by Style & Personality',
			'intro_1'       => 'Explore VTubers grouped by stream style, content type, and personality traits.',
			'intro_2'       => 'This page is an SEO collection hub designed for discovery beyond name-based search.',
			'card_prefix'   => '',
			'card_suffix'   => 'VTubers listed',
			'empty'         => 'No usable style tags are available yet.',
			'eyebrow'       => 'Topical SEO Hub',
			'related'       => 'Related hubs',
			'faq_title'     => 'FAQ',
			'faq_q1'        => 'What is this page for?',
			'faq_a1'        => 'It helps users discover VTubers by thematic style and personality, not just by names.',
			'faq_q2'        => 'Are tags maintained over time?',
			'faq_a2'        => 'Yes. The maintain pipeline refreshes tag relations and filters out noisy tags.',
		],
		'ko' => [
			'title'         => '스타일 / 개성으로 VTuber 찾기',
			'intro_1'       => '방송 스타일, 콘텐츠 유형, 캐릭터 성향 기준으로 VTuber를 묶어 빠르게 찾을 수 있습니다.',
			'intro_2'       => '이 페이지는 이름 검색 외 유입을 늘리기 위한 주제형 SEO 허브입니다.',
			'card_prefix'   => '수록',
			'card_suffix'   => '명',
			'empty'         => '사용 가능한 스타일 태그가 아직 없습니다.',
			'eyebrow'       => '주제형 허브',
			'related'       => '관련 허브',
			'faq_title'     => '자주 묻는 질문',
			'faq_q1'        => '이 페이지의 목적은 무엇인가요?',
			'faq_a1'        => '스타일/개성 기준 탐색 경로를 제공해 이름 검색 의존도를 낮춥니다.',
			'faq_q2'        => '태그는 계속 갱신되나요?',
			'faq_a2'        => '네. maintain 파이프라인에서 정기적으로 태그 관계를 갱신합니다.',
		],
		'es' => [
			'title'         => 'Explorar VTubers por estilo y personalidad',
			'intro_1'       => 'Encuentra VTubers agrupados por estilo de stream, tipo de contenido y rasgos de personalidad.',
			'intro_2'       => 'Esta página funciona como un hub SEO temático para mejorar descubrimiento e interlinking.',
			'card_prefix'   => '',
			'card_suffix'   => 'VTubers listados',
			'empty'         => 'Aún no hay etiquetas de estilo disponibles.',
			'eyebrow'       => 'Hub temático',
			'related'       => 'Hubs relacionados',
			'faq_title'     => 'Preguntas frecuentes',
			'faq_q1'        => '¿Para qué sirve esta página?',
			'faq_a1'        => 'Permite descubrir VTubers por tema y estilo, no solo por nombre.',
			'faq_q2'        => '¿Las etiquetas se actualizan?',
			'faq_a2'        => 'Sí. El flujo maintain refresca periódicamente las relaciones de etiquetas.',
		],
		'hi' => [
			'title'         => 'स्टाइल / व्यक्तित्व के आधार पर VTuber खोजें',
			'intro_1'       => 'स्ट्रीम स्टाइल, कंटेंट टाइप और व्यक्तित्व गुणों के आधार पर VTuber खोजें।',
			'intro_2'       => 'यह एक थीमैटिक SEO हब पेज है जो नाम-आधारित खोज से आगे खोजयोग्यता बढ़ाता है।',
			'card_prefix'   => '',
			'card_suffix'   => 'VTubers listed',
			'empty'         => 'अभी उपयोग योग्य स्टाइल टैग उपलब्ध नहीं हैं।',
			'eyebrow'       => 'थीमैटिक हब',
			'related'       => 'संबंधित हब',
			'faq_title'     => 'अक्सर पूछे जाने वाले प्रश्न',
			'faq_q1'        => 'यह पेज किस लिए है?',
			'faq_a1'        => 'यह उपयोगकर्ताओं को नाम के अलावा थीम/स्टाइल के आधार पर VTuber खोजने में मदद करता है।',
			'faq_q2'        => 'क्या टैग नियमित रूप से अपडेट होते हैं?',
			'faq_a2'        => 'हाँ। maintain पाइपलाइन टैग संबंधों को नियमित रूप से अपडेट करती है।',
		],
	];

	return $copy[ $lang ] ?? $copy['en'];
}

function vtportal_role_term_is_noise( $term ) {
	$name = trim( (string) ( $term->name ?? '' ) );
	$slug = trim( (string) ( $term->slug ?? '' ) );
	if ( '' === $name || '' === $slug ) {
		return true;
	}
	if ( strlen( $name ) < 2 || false !== strpos( $name, '??' ) ) {
		return true;
	}

	if ( preg_match( '/^indie(?:-[a-z]{2,3})?$/i', $slug ) ) {
		return true;
	}
	if ( preg_match( '/^(youtube|twitch|x|twitter|facebook|bluesky|instagram|tiktok)(?:-[a-z]{2,3})?$/i', $slug ) ) {
		return true;
	}

	$status_words = [ 'active', 'hiatus', 'retired', 'graduated', 'archive', 'suspended' ];
	foreach ( $status_words as $w ) {
		if ( false !== stripos( $slug, $w ) || false !== stripos( $name, $w ) ) {
			return true;
		}
	}

	return false;
}

$copy = vtportal_role_copy( $current_lang );
$terms = get_terms(
	[
		'taxonomy'   => 'role-tag',
		'hide_empty' => true,
	]
);
if ( is_wp_error( $terms ) ) {
	$terms = [];
}
$terms = array_values(
	array_filter(
		(array) $terms,
		static function ( $term ) {
			return ! vtportal_role_term_is_noise( $term );
		}
	)
);
usort(
	$terms,
	static function ( $a, $b ) {
		$cmp = intval( $b->count ) <=> intval( $a->count );
		if ( 0 !== $cmp ) {
			return $cmp;
		}
		return strcasecmp( (string) $a->name, (string) $b->name );
	}
);

$top_names = [];
foreach ( array_slice( $terms, 0, 8 ) as $t ) {
	$top_names[] = (string) $t->name;
}

$seo_desc = empty( $top_names )
	? $copy['intro_1']
	: $copy['intro_1'] . ' ' . implode( ', ', $top_names );

$faq_schema = [
	'@context'   => 'https://schema.org',
	'@type'      => 'FAQPage',
	'mainEntity' => [
		[
			'@type'          => 'Question',
			'name'           => $copy['faq_q1'],
			'acceptedAnswer' => [
				'@type' => 'Answer',
				'text'  => $copy['faq_a1'],
			],
		],
		[
			'@type'          => 'Question',
			'name'           => $copy['faq_q2'],
			'acceptedAnswer' => [
				'@type' => 'Answer',
				'text'  => $copy['faq_a2'],
			],
		],
	],
];
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<link rel="canonical" href="<?php echo esc_url( vtportal_url_with_lang( '/roles/', $current_lang ) ); ?>">
	<meta name="description" content="<?php echo esc_attr( $seo_desc ); ?>">
	<script type="application/ld+json"><?php echo wp_json_encode( $faq_schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ); ?></script>
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'vt-landing vt-landing-archive' ); ?>>
<main class="vt-layout">
	<div class="vt-top-bar">
		<div class="vt-pill-nav">
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/', $current_lang ) ); ?>"><?php esc_html_e( 'Home', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'vtuber', $current_lang ) ); ?>"><?php esc_html_e( 'VTuber List', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/agencies/', $current_lang ) ); ?>"><?php esc_html_e( 'By Agency', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/platforms/', $current_lang ) ); ?>"><?php esc_html_e( 'By Platform', 'vtuber-portal' ); ?></a>
		</div>
		<div class="vt-lang-wrap vt-lang-float">
			<span class="vt-lang-label"><?php esc_html_e( 'Language', 'vtuber-portal' ); ?></span>
			<?php if ( function_exists( 'vtportal_render_language_dropdown' ) ) : ?>
				<?php vtportal_render_language_dropdown(); ?>
			<?php elseif ( function_exists( 'pll_the_languages' ) ) : ?>
				<div class="pll-switcher"><?php pll_the_languages( [ 'dropdown' => 1, 'show_flags' => 1, 'display_names_as' => 'name' ] ); ?></div>
			<?php endif; ?>
		</div>
	</div>

	<section class="vt-section">
		<p class="vt-eyebrow"><?php echo esc_html( $copy['eyebrow'] ); ?></p>
		<h1><?php echo esc_html( $copy['title'] ); ?></h1>
		<p class="vt-body-text"><?php echo esc_html( $copy['intro_1'] ); ?></p>
		<p class="vt-body-text"><?php echo esc_html( $copy['intro_2'] ); ?></p>

		<div class="vt-body-text" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:10px 0 16px;">
			<span style="opacity:.85;"><?php echo esc_html( $copy['related'] ); ?>:</span>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/agencies/', $current_lang ) ); ?>"><?php esc_html_e( 'By Agency', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/platforms/', $current_lang ) ); ?>"><?php esc_html_e( 'By Platform', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/countries/', $current_lang ) ); ?>"><?php esc_html_e( 'By Country', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/debut-years/', $current_lang ) ); ?>"><?php esc_html_e( 'By Debut Year', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/contact/', $current_lang ) ); ?>"><?php esc_html_e( 'Contact / Suggestion', 'vtuber-portal' ); ?></a>
		</div>

		<?php if ( empty( $terms ) ) : ?>
			<p class="vt-body-text"><?php echo esc_html( $copy['empty'] ); ?></p>
		<?php else : ?>
			<div class="vt-card-grid neo" style="margin-top:18px;">
				<?php foreach ( $terms as $t ) : ?>
					<?php $t_link = get_term_link( $t ); ?>
					<?php if ( is_wp_error( $t_link ) ) { continue; } ?>
					<article class="vt-card">
						<a class="vt-card-block" href="<?php echo esc_url( $t_link ); ?>">
							<div class="vt-card-body">
								<h2 class="vt-card-title" style="margin-bottom:8px;"><?php echo esc_html( $t->name ); ?></h2>
								<p class="vt-card-excerpt">
									<?php
									echo esc_html(
										trim(
											$copy['card_prefix'] . ' ' . intval( $t->count ) . ' ' . $copy['card_suffix']
										)
									);
									?>
								</p>
								<?php if ( ! empty( $t->description ) ) : ?>
									<p class="vt-card-status"><?php echo esc_html( wp_trim_words( wp_strip_all_tags( (string) $t->description ), 24 ) ); ?></p>
								<?php endif; ?>
								<div class="vt-tax-list"><span class="pill"><?php esc_html_e( 'Style Tag', 'vtuber-portal' ); ?></span></div>
							</div>
						</a>
					</article>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
	</section>

	<section class="vt-section">
		<h2><?php echo esc_html( $copy['faq_title'] ); ?></h2>
		<div class="vt-faq-item">
			<h3><?php echo esc_html( $copy['faq_q1'] ); ?></h3>
			<p class="vt-body-text"><?php echo esc_html( $copy['faq_a1'] ); ?></p>
		</div>
		<div class="vt-faq-item">
			<h3><?php echo esc_html( $copy['faq_q2'] ); ?></h3>
			<p class="vt-body-text"><?php echo esc_html( $copy['faq_a2'] ); ?></p>
		</div>
	</section>
</main>
<?php wp_footer(); ?>
</body>
</html>
