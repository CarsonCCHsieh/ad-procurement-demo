<?php
/**
 * Template: Taxonomy Agency (standalone)
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

$term = get_queried_object();
if ( ! $term || is_wp_error( $term ) ) {
	status_header( 404 );
	exit;
}

function vtportal_display_name( $post_id ) {
	$b64 = get_post_meta( $post_id, 'vt_display_b64', true );
	if ( $b64 ) {
		$decoded = base64_decode( $b64, true );
		if ( $decoded ) {
			return $decoded;
		}
	}
	return get_the_title( $post_id );
}

function vtportal_filter_terms( $terms ) {
	if ( empty( $terms ) || is_wp_error( $terms ) ) {
		return [];
	}
	$out = [];
	foreach ( $terms as $t ) {
		$tax  = isset( $t->taxonomy ) ? (string) $t->taxonomy : '';
		$slug = isset( $t->slug ) ? (string) $t->slug : '';
		// Never show legacy "indie" as an organization.
		if ( 'agency' === $tax && 'indie' === $slug ) {
			continue;
		}
		$name = trim( $t->name );
		if ( strlen( $name ) < 2 ) {
			continue;
		}
		if ( false !== strpos( $name, '??' ) ) {
			continue;
		}
		$out[] = $t;
	}
	return $out;
}

$canonical = get_term_link( $term );
if ( is_wp_error( $canonical ) ) {
	$canonical = home_url( '/agencies/' );
}
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php if ( ! defined( 'WPSEO_VERSION' ) ) : ?>
		<meta name="description" content="<?php echo esc_attr( sprintf( __( '依組織整理 VTuber 與相關人物：%s。', 'vtuber-portal' ), (string) $term->name ) ); ?>">
	<?php endif; ?>
	<?php if ( function_exists( 'vtportal_render_polylang_seo_links_for_term' ) ) : ?>
		<?php vtportal_render_polylang_seo_links_for_term( $term ); ?>
	<?php elseif ( ! defined( 'WPSEO_VERSION' ) ) : ?>
		<link rel="canonical" href="<?php echo esc_url( $canonical ); ?>">
	<?php endif; ?>
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'vt-landing vt-landing-tax vt-landing-archive' ); ?>>
<!-- vt-taxonomy-template -->
<main class="vt-layout">
	<div class="vt-top-bar">
		<div class="vt-pill-nav">
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/', $current_lang ) ); ?>"><?php esc_html_e( '回首頁', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'vtuber', $current_lang ) ); ?>"><?php esc_html_e( 'VTuber 列表', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/roles/', $current_lang ) ); ?>"><?php esc_html_e( 'Style Tags', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/agencies/', $current_lang ) ); ?>"><?php esc_html_e( '依組織', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/platforms/', $current_lang ) ); ?>"><?php esc_html_e( '依平台', 'vtuber-portal' ); ?></a>
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
		<h1><?php echo esc_html( $term->name ); ?></h1>
		<?php if ( ! empty( $term->description ) ) : ?>
			<p class="vt-body-text"><?php echo esc_html( $term->description ); ?></p>
		<?php else : ?>
			<p class="vt-body-text"><?php esc_html_e( '依組織彙整的條目清單。', 'vtuber-portal' ); ?></p>
		<?php endif; ?>

		<div class="vt-body-text" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:10px 0 16px;">
			<span style="opacity:.85;"><?php esc_html_e( 'Related collections:', 'vtuber-portal' ); ?></span>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/roles/', $current_lang ) ); ?>"><?php esc_html_e( 'All Style Tags', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/agencies/', $current_lang ) ); ?>"><?php esc_html_e( 'By Agency', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/platforms/', $current_lang ) ); ?>"><?php esc_html_e( 'By Platform', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/countries/', $current_lang ) ); ?>"><?php esc_html_e( 'By Country', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/debut-years/', $current_lang ) ); ?>"><?php esc_html_e( 'By Debut Year', 'vtuber-portal' ); ?></a>
		</div>

		<?php if ( have_posts() ) : ?>
			<div class="vt-card-grid neo">
				<?php while ( have_posts() ) : the_post(); ?>
					<article class="vt-card">
						<a class="vt-card-overlay-link" href="<?php the_permalink(); ?>" aria-label="<?php echo esc_attr( vtportal_display_name( get_the_ID() ) ); ?>"></a>
						<?php
						$thumb = get_post_meta( get_the_ID(), 'vt_thumb_url', true );
						if ( has_post_thumbnail() ) :
							?>
							<a class="vt-card-thumb-wrap" href="<?php the_permalink(); ?>"><?php the_post_thumbnail( 'medium', [ 'class' => 'vt-card-thumb', 'alt' => esc_attr( vtportal_display_name( get_the_ID() ) ) ] ); ?></a>
						<?php elseif ( $thumb ) : ?>
							<a class="vt-card-thumb-wrap" href="<?php the_permalink(); ?>"><img class="vt-card-thumb" src="<?php echo esc_url( $thumb ); ?>" alt="<?php echo esc_attr( vtportal_display_name( get_the_ID() ) ); ?>" /></a>
						<?php else : ?>
							<a class="vt-card-thumb-wrap" href="<?php the_permalink(); ?>"><img class="vt-card-thumb" src="<?php echo esc_url( VT_PORTAL_URL . 'assets/vt-placeholder.png' ); ?>" alt="<?php echo esc_attr( vtportal_display_name( get_the_ID() ) ); ?>" /></a>
						<?php endif; ?>
						<div class="vt-card-body">
							<h3 class="vt-card-title"><a href="<?php the_permalink(); ?>"><?php echo esc_html( vtportal_display_name( get_the_ID() ) ); ?></a></h3>
							<p class="vt-card-excerpt"><?php echo esc_html( wp_trim_words( get_the_excerpt(), 20 ) ); ?></p>
							<div class="vt-tax-list">
								<?php
								$agencies  = vtportal_filter_terms( get_the_terms( get_the_ID(), 'agency' ) );
								$platforms = vtportal_filter_terms( get_the_terms( get_the_ID(), 'platform' ) );
								$roles     = vtportal_filter_terms( get_the_terms( get_the_ID(), 'role-tag' ) );

								$shown = 0;
								foreach ( [ $agencies, $platforms, $roles ] as $list ) {
									if ( empty( $list ) ) {
										continue;
									}
									foreach ( $list as $t ) {
										$t_link = get_term_link( $t );
										if ( ! is_wp_error( $t_link ) ) {
											echo '<a class="pill pill-link" href="' . esc_url( $t_link ) . '">' . esc_html( $t->name ) . '</a>';
										} else {
											echo '<span class="pill">' . esc_html( $t->name ) . '</span>';
										}
										$shown++;
										if ( $shown >= 3 ) {
											break 2;
										}
									}
								}
								?>
							</div>
						</div>
					</article>
				<?php endwhile; ?>
			</div>
			<div class="vt-pagination"><?php the_posts_pagination(); ?></div>
		<?php else : ?>
			<p class="vt-body-text"><?php esc_html_e( '尚無內容。', 'vtuber-portal' ); ?></p>
		<?php endif; ?>
	</section>
</main>
<?php wp_footer(); ?>
</body>
</html>
