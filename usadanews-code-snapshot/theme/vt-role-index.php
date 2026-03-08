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
	$lang = sanitize_title( (string) $lang );
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

function vtportal_role_term_is_noise( $term ) {
	$name = trim( (string) ( $term->name ?? '' ) );
	$slug = trim( (string) ( $term->slug ?? '' ) );
	if ( '' === $name || '' === $slug ) {
		return true;
	}
	if ( strlen( $name ) < 2 ) {
		return true;
	}
	if ( false !== strpos( $name, '??' ) ) {
		return true;
	}
	if ( preg_match( '/^indie(?:-[a-z]{2,3})?$/i', $slug ) ) {
		return true;
	}
	if ( preg_match( '/^(youtube|twitch|x|twitter|facebook|bluesky)(?:-[a-z]{2,3})?$/i', $slug ) ) {
		return true;
	}
	if ( preg_match( '/(活動中|休止|暫停|畢業|卒業|引退|封存|active|hiatus|graduat|archiv)/iu', $name ) ) {
		return true;
	}
	return false;
}

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
		static function ( $t ) {
			return ! vtportal_role_term_is_noise( $t );
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
$seo_desc = ! empty( $top_names )
	? sprintf( __( '依風格與個性瀏覽 VTuber：%s 等熱門標籤。', 'vtuber-portal' ), implode( '、', $top_names ) )
	: __( '依風格與個性標籤瀏覽 VTuber，快速找到同類型創作者。', 'vtuber-portal' );
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<link rel="canonical" href="<?php echo esc_url( vtportal_url_with_lang( '/roles/', $current_lang ) ); ?>">
	<meta name="description" content="<?php echo esc_attr( $seo_desc ); ?>">
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'vt-landing vt-landing-archive' ); ?>>
<main class="vt-layout">
	<div class="vt-top-bar">
		<div class="vt-pill-nav">
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/', $current_lang ) ); ?>"><?php esc_html_e( '回首頁', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'vtuber', $current_lang ) ); ?>"><?php esc_html_e( 'VTuber 列表', 'vtuber-portal' ); ?></a>
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
		<h1><?php esc_html_e( '依風格 / 個性瀏覽', 'vtuber-portal' ); ?></h1>
		<p class="vt-body-text"><?php echo esc_html( $seo_desc ); ?></p>
		<p class="vt-body-text"><?php esc_html_e( '這些集合頁可幫助你快速找到同風格 VTuber，也可作為 SEO 友善的主題入口。', 'vtuber-portal' ); ?></p>
		<div class="vt-pill-nav" style="margin-top:12px;">
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/countries/', $current_lang ) ); ?>"><?php esc_html_e( '依國家', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/debut-years/', $current_lang ) ); ?>"><?php esc_html_e( '依出道年', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/contact/', $current_lang ) ); ?>"><?php esc_html_e( '提交建議', 'vtuber-portal' ); ?></a>
		</div>

		<?php if ( empty( $terms ) ) : ?>
			<p class="vt-body-text"><?php esc_html_e( '目前尚無可用的風格標籤資料。', 'vtuber-portal' ); ?></p>
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
										sprintf(
											/* translators: %d: count */
											__( '收錄 %d 個條目', 'vtuber-portal' ),
											intval( $t->count )
										)
									);
									?>
								</p>
								<?php if ( ! empty( $t->description ) ) : ?>
									<p class="vt-card-status"><?php echo esc_html( wp_trim_words( wp_strip_all_tags( (string) $t->description ), 18 ) ); ?></p>
								<?php endif; ?>
								<div class="vt-tax-list"><span class="pill"><?php esc_html_e( '風格標籤', 'vtuber-portal' ); ?></span></div>
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
