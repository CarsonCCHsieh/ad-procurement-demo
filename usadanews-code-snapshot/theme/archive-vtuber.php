<?php
/**
 * Archive: VTuber (standalone)
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$current_lang = function_exists( 'pll_current_language' ) ? (string) pll_current_language( 'slug' ) : 'zh';

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
	foreach ( $terms as $term ) {
		$tax  = isset( $term->taxonomy ) ? (string) $term->taxonomy : '';
		$slug = isset( $term->slug ) ? (string) $term->slug : '';
		// Never treat Indie/個人勢 as an organization (legacy data may include indie-zh etc).
		if ( 'agency' === $tax && preg_match( '/^indie(?:-[a-z]{2,3})?$/i', $slug ) ) {
			continue;
		}
		$name = trim( $term->name );
		if ( 'agency' === $tax && preg_match( '/^(indie|independent|solo|個人勢|個人)$/iu', $name ) ) {
			continue;
		}
		// Keep life-status only in the `life-status` taxonomy (avoid showing status-like role tags).
		if ( 'role-tag' === $tax && preg_match( '/(活動中|休止|暫停|畢業|卒業|引退|封存|archiv|hiatus|graduat|active)/iu', $name ) ) {
			continue;
		}
		if ( strlen( $name ) < 2 ) {
			continue;
		}
		if ( false !== strpos( $name, '??' ) ) {
			continue;
		}
		if ( isset( $term->taxonomy ) && 'role-tag' === (string) $term->taxonomy && preg_match( '/(轉生|转生|reincarn)/iu', $name ) ) {
			continue;
		}
		$out[] = $term;
	}
	return $out;
}

function vtportal_page_url_by_template_for_lang( $template, $lang = '' ) {
	$template = trim( (string) $template );
	$lang = sanitize_title( (string) $lang );
	if ( '' === $template ) {
		return '';
	}
	static $base_page_by_template = [];
	static $url_cache = [];
	$ck = $template . '|' . $lang;
	if ( isset( $url_cache[ $ck ] ) ) {
		return $url_cache[ $ck ];
	}
	if ( ! array_key_exists( $template, $base_page_by_template ) ) {
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
		$base_page_by_template[ $template ] = intval( $q->posts[0] ?? 0 );
		wp_reset_postdata();
	}
	$base_id = intval( $base_page_by_template[ $template ] ?? 0 );
	if ( $base_id <= 0 ) {
		$url_cache[ $ck ] = '';
		return $url_cache[ $ck ];
	}
	if ( function_exists( 'pll_get_post_translations' ) && '' !== $lang ) {
		$map = pll_get_post_translations( $base_id );
		$tid = intval( is_array( $map ) ? ( $map[ $lang ] ?? 0 ) : 0 );
		if ( $tid > 0 ) {
			$u = get_permalink( $tid );
			if ( is_string( $u ) && '' !== $u ) {
				$url_cache[ $ck ] = $u;
				return $url_cache[ $ck ];
			}
		}
	}
	$u = get_permalink( $base_id );
	$url_cache[ $ck ] = is_string( $u ) ? $u : '';
	return $url_cache[ $ck ];
}

function vtportal_url_with_lang( $path, $lang = '' ) {
	$path = '/' . ltrim( (string) $path, '/' );
	$lang = sanitize_title( (string) $lang );
	$special_pages = [
		'/platforms/' => 'vt-platform-index.php',
		'/agencies/'  => 'vt-agency-index.php',
		'/countries/' => 'vt-country-index.php',
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

function vtportal_lifecycle_label( $post_id ) {
	$terms = get_the_terms( $post_id, 'life-status' );
	$slug  = 'active';
	if ( ! empty( $terms ) && ! is_wp_error( $terms ) ) {
		$t = reset( $terms );
		if ( $t && ! empty( $t->slug ) ) {
			$raw = (string) $t->slug;
			if ( preg_match( '/^(active|graduated|reincarnated|hiatus)(?:-[a-z]{2,3})?$/i', sanitize_title( $raw ), $m ) ) {
				$slug = strtolower( (string) $m[1] );
			} else {
				$slug = sanitize_title( $raw );
			}
		}
		// Prefer the taxonomy term name (supports Polylang translated terms like "Hiatus").
		if ( $t && ! empty( $t->name ) ) {
			return (string) $t->name;
		}
	} else {
		$m = (string) get_post_meta( $post_id, 'vt_lifecycle_status', true );
		if ( '' !== trim( $m ) ) {
			$raw = (string) $m;
			if ( preg_match( '/^(active|graduated|reincarnated|hiatus)(?:-[a-z]{2,3})?$/i', sanitize_title( $raw ), $m2 ) ) {
				$slug = strtolower( (string) $m2[1] );
			} else {
				$slug = sanitize_title( $raw );
			}
		}
	}
	$labels = [
		'active'       => __( '活動中', 'vtuber-portal' ),
		'graduated'    => __( '已畢業 / 引退', 'vtuber-portal' ),
		'reincarnated' => __( '轉生 / 前世', 'vtuber-portal' ),
		'hiatus'       => __( '休止中', 'vtuber-portal' ),
	];
	return $labels[ $slug ] ?? $labels['active'];
}

$has_anime_content = function_exists( 'vtportal_has_public_content' ) ? vtportal_has_public_content( 'anime-work', $current_lang ) : true;
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php
	// Focused SEO for VTuber archive; keep minimal to avoid plugin conflicts.
	if ( ! defined( 'WPSEO_VERSION' ) ) :
		$vt_desc        = __( 'USADA 提供多語系 VTuber 資料庫：訂閱數、社群連結、代表影片與常見問答，依更新時間與訂閱數展示人氣 VTuber。', 'vtuber-portal' );
		?>
		<meta name="description" content="<?php echo esc_attr( $vt_desc ); ?>">
	<?php endif; ?>
	<?php if ( function_exists( 'vtportal_render_polylang_seo_links_for_archive' ) ) : ?>
		<?php vtportal_render_polylang_seo_links_for_archive(); ?>
	<?php elseif ( ! defined( 'WPSEO_VERSION' ) ) : ?>
		<link rel="canonical" href="<?php echo esc_url( get_post_type_archive_link( 'vtuber' ) ); ?>">
	<?php endif; ?>
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'vt-landing vt-landing-archive' ); ?>>
<main class="vt-layout">
	<div class="vt-top-bar">
		<div class="vt-pill-nav">
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/', $current_lang ) ); ?>"><?php esc_html_e( '回首頁', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/roles/', $current_lang ) ); ?>"><?php esc_html_e( '依風格', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/agencies/', $current_lang ) ); ?>"><?php esc_html_e( '依組織', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/platforms/', $current_lang ) ); ?>"><?php esc_html_e( '依平台', 'vtuber-portal' ); ?></a>
			<?php if ( $has_anime_content ) : ?>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'anime-work', $current_lang ) ); ?>"><?php esc_html_e( '作品資料庫', 'vtuber-portal' ); ?></a>
			<?php endif; ?>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'character', $current_lang ) ); ?>"><?php esc_html_e( '角色資料庫', 'vtuber-portal' ); ?></a>
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
		<h1><?php esc_html_e( 'VTuber 資料庫', 'vtuber-portal' ); ?></h1>
		<p class="vt-body-text"><?php esc_html_e( '多語系整理人氣 VTuber 資訊、訂閱數與角色設定。', 'vtuber-portal' ); ?></p>
		<?php
		$sort = isset( $_GET['sort'] ) ? sanitize_key( (string) $_GET['sort'] ) : '';
		$sort_label = ( 'updated' === $sort ) ? __( '依最近更新時間排序（最新優先）', 'vtuber-portal' ) : __( '依 YouTube 訂閱數排序（高到低）', 'vtuber-portal' );
		$u_youtube = remove_query_arg( [ 'sort', 'paged' ] );
		$u_updated = add_query_arg( [ 'sort' => 'updated' ], $u_youtube );
		?>
		<div class="vt-body-text" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px;">
			<span style="opacity:.85;"><?php echo esc_html( $sort_label ); ?></span>
			<a class="vt-pill" href="<?php echo esc_url( $u_youtube ); ?>"><?php esc_html_e( 'YouTube 訂閱', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( $u_updated ); ?>"><?php esc_html_e( '最近更新', 'vtuber-portal' ); ?></a>
		</div>

		<?php
		$has_posts = have_posts();
		if ( $has_posts ) :
		?>
			<div class="vt-card-grid neo">
				<?php
				$loop = $GLOBALS['wp_query'];
				while ( $loop->have_posts() ) :
					$loop->the_post();
					?>
					<article class="vt-card">
						<a class="vt-card-overlay-link" href="<?php the_permalink(); ?>" aria-label="<?php echo esc_attr( vtportal_display_name( get_the_ID() ) ); ?>"></a>
						<?php
						$thumb = get_post_meta( get_the_ID(), 'vt_thumb_url', true );
						if ( empty( $thumb ) ) {
							$thumb = get_post_meta( get_the_ID(), 'vt_thumb_source_url', true );
						}
						if ( has_post_thumbnail() ) :
							?>
							<a class="vt-card-thumb-wrap" href="<?php the_permalink(); ?>"><?php the_post_thumbnail( 'medium', [ 'class' => 'vt-card-thumb', 'alt' => esc_attr( vtportal_display_name( get_the_ID() ) ) ] ); ?></a>
						<?php elseif ( $thumb ) : ?>
							<a class="vt-card-thumb-wrap" href="<?php the_permalink(); ?>"><img loading="lazy" decoding="async" class="vt-card-thumb" src="<?php echo esc_url( $thumb ); ?>" alt="<?php echo esc_attr( vtportal_display_name( get_the_ID() ) ); ?>" /></a>
						<?php else : ?>
							<a class="vt-card-thumb-wrap" href="<?php the_permalink(); ?>"><img loading="lazy" decoding="async" class="vt-card-thumb" src="<?php echo esc_url( VT_PORTAL_URL . 'assets/vt-placeholder.png' ); ?>" alt="<?php echo esc_attr( vtportal_display_name( get_the_ID() ) ); ?>" /></a>
						<?php endif; ?>
						<div class="vt-card-body">
							<h3 class="vt-card-title"><a href="<?php the_permalink(); ?>"><?php echo esc_html( vtportal_display_name( get_the_ID() ) ); ?></a></h3>
							<p class="vt-card-status"><?php echo esc_html( vtportal_lifecycle_label( get_the_ID() ) ); ?></p>
							<?php
							$archive_excerpt_raw = (string) get_the_excerpt();
							if ( function_exists( 'vtportal_localize_snippet_text' ) ) {
								$archive_excerpt_raw = vtportal_localize_snippet_text( $archive_excerpt_raw, $current_lang );
							}
							?>
							<p class="vt-card-excerpt"><?php echo esc_html( wp_trim_words( $archive_excerpt_raw, 20 ) ); ?></p>
							<div class="vt-tax-list">
								<?php
								$agencies = vtportal_filter_terms( get_the_terms( get_the_ID(), 'agency' ) );
								$platforms = vtportal_filter_terms( get_the_terms( get_the_ID(), 'platform' ) );
								$countries = vtportal_filter_terms( get_the_terms( get_the_ID(), 'country' ) );
								$roles     = vtportal_filter_terms( get_the_terms( get_the_ID(), 'role-tag' ) );

								// Keep cards scannable: show a small, consistent set of chips.
								$shown = 0;
								foreach ( [ $countries, $agencies, $platforms, $roles ] as $list ) {
									if ( empty( $list ) ) {
										continue;
									}
									foreach ( $list as $term ) {
										$t_link = get_term_link( $term );
										if ( ! is_wp_error( $t_link ) ) {
											echo '<a class="pill pill-link" href="' . esc_url( $t_link ) . '">' . esc_html( $term->name ) . '</a>';
										} else {
											echo '<span class="pill">' . esc_html( $term->name ) . '</span>';
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
			<div class="vt-pagination">
				<?php
				the_posts_pagination();
				?>
			</div>
		<?php else : ?>
			<p><?php esc_html_e( '此語系資料仍在建立中，請稍後再試。', 'vtuber-portal' ); ?></p>
		<?php endif; ?>
	</section>
</main>
<?php wp_footer(); ?>
</body>
</html>

