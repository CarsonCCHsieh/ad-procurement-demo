<?php
/**
 * Template Name: VT Contact
 * Template Post Type: page
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$email = get_option( 'admin_email' );
$current_lang = function_exists( 'pll_current_language' ) ? (string) pll_current_language( 'slug' ) : 'zh';

function vtportal_page_url_by_template_for_lang( $template, $lang = '' ) {
	$template = trim( (string) $template );
	$lang = sanitize_title( (string) $lang );
	if ( '' === $template ) {
		return '';
	}
	$q = new WP_Query(
		[
			'post_type'        => 'page',
			'post_status'      => 'publish',
			'posts_per_page'   => 1,
			'orderby'          => 'ID',
			'order'            => 'ASC',
			'fields'           => 'ids',
			'suppress_filters' => true,
			'meta_query'       => [
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
		'/platforms/' => 'vt-platform-index.php',
		'/agencies/'  => 'vt-agency-index.php',
		'/countries/' => 'vt-country-index.php',
		'/debut-years/' => 'vt-debut-year-index.php',
		'/roles/'       => 'vt-role-index.php',
		'/contact/'   => 'vt-contact.php',
	];
	$path_key = '/' . trim( $path, '/' ) . '/';
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
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<link rel="canonical" href="<?php echo esc_url( vtportal_url_with_lang( '/contact/', $current_lang ) ); ?>">
	<meta name="description" content="<?php echo esc_attr( __( 'USADA 聯絡方式與合作投放資訊。', 'vtuber-portal' ) ); ?>">
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'vt-landing vt-landing-archive' ); ?>>
<main class="vt-layout">
	<div class="vt-top-bar">
		<div class="vt-pill-nav">
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/', $current_lang ) ); ?>"><?php esc_html_e( '回首頁', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'vtuber', $current_lang ) ); ?>"><?php esc_html_e( 'VTuber 列表', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/roles/', $current_lang ) ); ?>"><?php esc_html_e( 'Style Tags', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/platforms/', $current_lang ) ); ?>"><?php esc_html_e( '依平台', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/agencies/', $current_lang ) ); ?>"><?php esc_html_e( '依組織', 'vtuber-portal' ); ?></a>
		</div>
		<div class="vt-lang-wrap vt-lang-float">
			<span class="vt-lang-label"><?php esc_html_e( '語言', 'vtuber-portal' ); ?></span>
			<?php if ( function_exists( 'vtportal_render_language_dropdown' ) ) : ?>
				<?php vtportal_render_language_dropdown(); ?>
			<?php elseif ( function_exists( 'pll_the_languages' ) ) : ?>
				<div class="pll-switcher"><?php pll_the_languages( [ 'dropdown' => 1, 'show_flags' => 1, 'display_names_as' => 'name' ] ); ?></div>
			<?php endif; ?>
		</div>
	</div>

	<section class="vt-section">
		<h1><?php esc_html_e( '聯絡我們 / 合作投放', 'vtuber-portal' ); ?></h1>
		<p class="vt-body-text"><?php esc_html_e( '合作、投放、資料更正、授權或其他事務，請使用以下方式聯絡。', 'vtuber-portal' ); ?></p>

		<div class="vt-card-grid neo">
			<article class="vt-card">
				<div class="vt-card-body">
					<h3 class="vt-card-title"><?php esc_html_e( 'Email', 'vtuber-portal' ); ?></h3>
					<p class="vt-card-excerpt">
						<a style="color:#2dd4bf;" href="<?php echo esc_url( 'mailto:' . antispambot( $email ) ); ?>">
							<?php echo esc_html( antispambot( $email ) ); ?>
						</a>
					</p>
					<div class="vt-tax-list"><span class="pill"><?php esc_html_e( '回覆時間', 'vtuber-portal' ); ?></span></div>
					<p class="vt-card-excerpt"><?php esc_html_e( '通常 1-3 個工作天內回覆。', 'vtuber-portal' ); ?></p>
				</div>
			</article>

			<article class="vt-card">
				<div class="vt-card-body">
					<h3 class="vt-card-title"><?php esc_html_e( '資料更正', 'vtuber-portal' ); ?></h3>
					<p class="vt-card-excerpt"><?php esc_html_e( '若條目資訊或連結有誤，請提供正確來源連結與修正內容。', 'vtuber-portal' ); ?></p>
					<div class="vt-tax-list"><span class="pill"><?php esc_html_e( '維護', 'vtuber-portal' ); ?></span></div>
				</div>
			</article>

			<article class="vt-card">
				<div class="vt-card-body">
					<h3 class="vt-card-title"><?php esc_html_e( '合作投放', 'vtuber-portal' ); ?></h3>
					<p class="vt-card-excerpt"><?php esc_html_e( '可提供合作目標、時程、素材規格與預算範圍，我們會回覆可行方案。', 'vtuber-portal' ); ?></p>
					<div class="vt-tax-list"><span class="pill"><?php esc_html_e( '商務', 'vtuber-portal' ); ?></span></div>
				</div>
			</article>
		</div>
	</section>
</main>
<?php wp_footer(); ?>
</body>
</html>
