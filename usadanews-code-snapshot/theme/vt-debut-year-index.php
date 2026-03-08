<?php
/**
 * Template Name: VT Debut Year Index
 * Template Post Type: page
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

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
		'/platforms/'   => 'vt-platform-index.php',
		'/agencies/'    => 'vt-agency-index.php',
		'/countries/'   => 'vt-country-index.php',
				'/roles/'       => 'vt-role-index.php',
		'/contact/'     => 'vt-contact.php',
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

$terms = get_terms(
	[
		'taxonomy'   => 'debut-year',
		'hide_empty' => true,
	]
);

if ( is_wp_error( $terms ) ) {
	$terms = [];
}

// Sort numerically by year desc.
usort(
	$terms,
	function ( $a, $b ) {
		return intval( $b->name ) <=> intval( $a->name );
	}
);
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<link rel="canonical" href="<?php echo esc_url( vtportal_url_with_lang( '/debut-years/', $current_lang ) ); ?>">
	<meta name="description" content="<?php echo esc_attr( __( '渚濆嚭閬撳勾浠界€忚 VTuber锛氬揩閫熸煡鐪嬪悇骞翠唤姊濈洰鏁镐甫閫插叆娓呭柈銆?', 'vtuber-portal' ) ); ?>">
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'vt-landing vt-landing-archive' ); ?>>
<main class="vt-layout">
	<div class="vt-top-bar">
		<div class="vt-pill-nav">
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/', $current_lang ) ); ?>"><?php esc_html_e( '鍥為闋?', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'vtuber', $current_lang ) ); ?>"><?php esc_html_e( 'VTuber 鍒楄〃', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/roles/', $current_lang ) ); ?>"><?php esc_html_e( '依風格', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/platforms/', $current_lang ) ); ?>"><?php esc_html_e( '渚濆钩鍙?', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/agencies/', $current_lang ) ); ?>"><?php esc_html_e( '渚濈祫绻?', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/countries/', $current_lang ) ); ?>"><?php esc_html_e( '渚濆湅瀹?', 'vtuber-portal' ); ?></a>
		</div>
		<div class="vt-lang-wrap vt-lang-float">
			<span class="vt-lang-label"><?php esc_html_e( '瑾炶█', 'vtuber-portal' ); ?></span>
			<?php if ( function_exists( 'vtportal_render_language_dropdown' ) ) : ?>
				<?php vtportal_render_language_dropdown(); ?>
			<?php elseif ( function_exists( 'pll_the_languages' ) ) : ?>
				<div class="pll-switcher"><?php pll_the_languages( [ 'dropdown' => 1, 'show_flags' => 1, 'display_names_as' => 'name' ] ); ?></div>
			<?php endif; ?>
		</div>
	</div>

	<section class="vt-section">
		<h1><?php esc_html_e( '渚濆嚭閬撳勾浠界€忚', 'vtuber-portal' ); ?></h1>
		<p class="vt-body-text"><?php esc_html_e( '渚濆嚭閬撳勾浠藉綑鏁?VTuber 姊濈洰锛岄粸鎿婂嵆鍙閬搞€?', 'vtuber-portal' ); ?></p>

		<?php if ( empty( $terms ) ) : ?>
			<p class="vt-body-text"><?php esc_html_e( '灏氱劇鍑洪亾骞翠唤璩囨枡銆?', 'vtuber-portal' ); ?></p>
		<?php else : ?>
			<div class="vt-card-grid neo">
				<?php foreach ( $terms as $t ) : ?>
					<article class="vt-card">
						<a class="vt-card-block" href="<?php echo esc_url( get_term_link( $t ) ); ?>">
							<div class="vt-card-body">
								<h3 class="vt-card-title"><?php echo esc_html( $t->name ); ?></h3>
								<p class="vt-card-excerpt">
									<?php
									echo esc_html(
										sprintf(
											/* translators: %d: count */
											__( '%d 鍊嬫鐩?', 'vtuber-portal' ),
											intval( $t->count )
										)
									);
									?>
								</p>
								<div class="vt-tax-list"><span class="pill"><?php esc_html_e( '鍑洪亾骞翠唤', 'vtuber-portal' ); ?></span></div>
							</div>
						</a>
					</article>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
	</section>
</main>
<?php wp_footer(); ?>
</body>
</html>

