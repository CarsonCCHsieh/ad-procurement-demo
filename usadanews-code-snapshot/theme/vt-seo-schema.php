<?php
/**
 * Lightweight SEO/meta + JSON-LD for VTuber site.
 * Runs as MU-plugin to avoid theme dependency.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function vtseo_get_display_name( $post_id ) {
	$b64 = get_post_meta( $post_id, 'vt_display_b64', true );
	if ( $b64 ) {
		$decoded = base64_decode( $b64, true );
		if ( $decoded ) {
			return $decoded;
		}
	}
	return get_the_title( $post_id );
}

function vtseo_get_summary( $post_id ) {
	$summary = get_post_meta( $post_id, 'vt_summary', true );
	if ( $summary ) {
		return wp_strip_all_tags( $summary );
	}
	$excerpt = get_the_excerpt( $post_id );
	if ( $excerpt ) {
		return wp_strip_all_tags( $excerpt );
	}
	return '';
}

function vtseo_get_image( $post_id ) {
	if ( has_post_thumbnail( $post_id ) ) {
		$img = wp_get_attachment_image_url( get_post_thumbnail_id( $post_id ), 'large' );
		if ( $img ) {
			return $img;
		}
	}
	$thumb = get_post_meta( $post_id, 'vt_thumb_url', true );
	if ( $thumb ) {
		return $thumb;
	}
	$site_icon = get_site_icon_url( 512 );
	return $site_icon ? $site_icon : '';
}

function vtseo_render_meta() {
	if ( is_admin() ) {
		return;
	}

	$site_name = get_bloginfo( 'name' );
	$canonical = '';
	$title     = '';
	$desc      = '';
	$image     = '';
	$og_type   = 'website';

	if ( is_singular( 'vtuber' ) ) {
		$post_id  = get_queried_object_id();
		$name     = vtseo_get_display_name( $post_id );
		$title    = $name . ' | ' . $site_name;
		$desc     = vtseo_get_summary( $post_id );
		$image    = vtseo_get_image( $post_id );
		$canonical = get_permalink( $post_id );
		$og_type  = 'article';
	} elseif ( is_post_type_archive( 'vtuber' ) ) {
		$title     = __( 'VTuber 資料庫', 'vtuber-portal' ) . ' | ' . $site_name;
		$desc      = __( '多語系整理 VTuber 資訊、訂閱數與角色設定。', 'vtuber-portal' );
		$canonical = get_post_type_archive_link( 'vtuber' );
		$image     = get_site_icon_url( 512 );
	} elseif ( is_front_page() || is_home() ) {
		$title     = $site_name . ' · VTuber / 聲優 / 動漫資料索引';
		$desc      = __( '多語系 VTuber、聲優、動畫與角色資料庫，提供訂閱數、社群連結、代表影片與常見問答。', 'vtuber-portal' );
		$canonical = home_url( '/' );
		$image     = get_site_icon_url( 512 );
	} else {
		$title     = wp_get_document_title();
		$desc      = get_bloginfo( 'description' );
		$canonical = home_url( add_query_arg( [], $GLOBALS['wp']->request ) );
		$image     = get_site_icon_url( 512 );
	}

	if ( $title ) {
		echo '<meta property="og:title" content="' . esc_attr( $title ) . "\" />\n";
		echo '<meta name="twitter:title" content="' . esc_attr( $title ) . "\" />\n";
	}
	if ( $desc ) {
		echo '<meta name="description" content="' . esc_attr( $desc ) . "\" />\n";
		echo '<meta property="og:description" content="' . esc_attr( $desc ) . "\" />\n";
		echo '<meta name="twitter:description" content="' . esc_attr( $desc ) . "\" />\n";
	}
	if ( $canonical ) {
		echo '<link rel="canonical" href="' . esc_url( $canonical ) . "\" />\n";
		echo '<meta property="og:url" content="' . esc_url( $canonical ) . "\" />\n";
	}
	if ( $image ) {
		echo '<meta property="og:image" content="' . esc_url( $image ) . "\" />\n";
		echo '<meta name="twitter:image" content="' . esc_url( $image ) . "\" />\n";
		echo '<meta name="twitter:card" content="summary_large_image" />' . "\n";
	} else {
		echo '<meta name="twitter:card" content="summary" />' . "\n";
	}
	echo '<meta property="og:type" content="' . esc_attr( $og_type ) . "\" />\n";
	echo '<meta property="og:site_name" content="' . esc_attr( $site_name ) . "\" />\n";
}

add_action( 'wp_head', 'vtseo_render_meta', 2 );

function vtseo_render_schema() {
	// If Yoast (or other SEO plugin) already outputs JSON-LD, avoid duplicate graph.
	if ( defined( 'WPSEO_VERSION' ) || function_exists( 'wpseo_json_ld_output' ) ) {
		return;
	}
	if ( is_admin() ) {
		return;
	}

	$site_name = get_bloginfo( 'name' );
	$schemas   = [];

	if ( is_front_page() || is_home() ) {
		$schemas[] = [
			'@context'  => 'https://schema.org',
			'@type'     => 'Organization',
			'name'      => $site_name,
			'url'       => home_url( '/' ),
			'logo'      => get_site_icon_url( 512 ),
		];
		$schemas[] = [
			'@context'        => 'https://schema.org',
			'@type'           => 'WebSite',
			'name'            => $site_name,
			'url'             => home_url( '/' ),
			'potentialAction' => [
				'@type'       => 'SearchAction',
				'target'      => home_url( '/?s={search_term_string}' ),
				'query-input' => 'required name=search_term_string',
			],
		];
	} elseif ( is_singular( 'vtuber' ) ) {
		$post_id = get_queried_object_id();
		$name    = vtseo_get_display_name( $post_id );
		$image   = vtseo_get_image( $post_id );
		$desc    = vtseo_get_summary( $post_id );
		$same_as = [];
		$keys    = [
			'vt_youtube_url',
			'vt_twitch_url',
			'vt_twitter_url',
			'vt_facebook_url',
			'vt_instagram',
			'vt_discord',
			'vt_bluesky_url',
			'vt_plurk',
		];
		foreach ( $keys as $key ) {
			$val = get_post_meta( $post_id, $key, true );
			if ( $val ) {
				$same_as[] = $val;
			}
		}

		$schemas[] = [
			'@context'   => 'https://schema.org',
			'@type'      => 'ProfilePage',
			'url'        => get_permalink( $post_id ),
			'name'       => $name,
			'mainEntity' => [
				'@type'       => 'Person',
				'name'        => $name,
				'description' => $desc,
				'image'       => $image,
				'sameAs'      => $same_as,
			],
		];
	} elseif ( is_post_type_archive( 'vtuber' ) ) {
		$page = max( 1, get_query_var( 'paged' ) );
		$items = [];
		$q = new WP_Query(
			[
				'post_type'      => 'vtuber',
				'posts_per_page' => 24,
				'paged'          => $page,
				'no_found_rows'  => true,
			]
		);
		if ( $q->have_posts() ) {
			$pos = 1;
			while ( $q->have_posts() ) {
				$q->the_post();
				$items[] = [
					'@type'    => 'ListItem',
					'position' => $pos,
					'url'      => get_permalink(),
					'name'     => vtseo_get_display_name( get_the_ID() ),
				];
				$pos++;
			}
			wp_reset_postdata();
		}
		$schemas[] = [
			'@context'        => 'https://schema.org',
			'@type'           => 'CollectionPage',
			'name'            => __( 'VTuber 資料庫', 'vtuber-portal' ),
			'url'             => get_post_type_archive_link( 'vtuber' ),
			'mainEntity'      => [
				'@type'           => 'ItemList',
				'itemListElement' => $items,
			],
		];
	}

	if ( empty( $schemas ) ) {
		return;
	}
	foreach ( $schemas as $schema ) {
		echo "<script type=\"application/ld+json\">" . wp_json_encode( $schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . "</script>\n";
	}
}

add_action( 'wp_head', 'vtseo_render_schema', 4 );
