<?php
/**
 * Lightweight VTuber news aggregator (Google News RSS).
 * - Shows only title/source/date and link back to the origin site (no copy-paste of body).
 * - Per-VTuber cache (transient) to avoid frequent requests.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'vt_news_log' ) ) {
	function vt_news_log( $msg ) {
		$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
		}
		@file_put_contents( $dir . 'news-refresh.log', gmdate( 'c' ) . ' ' . (string) $msg . "\n", FILE_APPEND );
	}
}

if ( ! function_exists( 'vt_news_language_profile' ) ) {
	function vt_news_language_profile() {
		$slug = function_exists( 'pll_current_language' ) ? (string) pll_current_language( 'slug' ) : 'zh';
		$map = [
			'zh' => [ 'hl' => 'zh-TW', 'gl' => 'TW', 'ceid' => 'TW:zh-Hant', 'suffix' => 'VTuber' ],
			'cn' => [ 'hl' => 'zh-CN', 'gl' => 'CN', 'ceid' => 'CN:zh-Hans', 'suffix' => '虚拟主播' ],
			'ja' => [ 'hl' => 'ja', 'gl' => 'JP', 'ceid' => 'JP:ja', 'suffix' => 'VTuber' ],
			'en' => [ 'hl' => 'en', 'gl' => 'US', 'ceid' => 'US:en', 'suffix' => 'VTuber news' ],
			'ko' => [ 'hl' => 'ko', 'gl' => 'KR', 'ceid' => 'KR:ko', 'suffix' => '버튜버' ],
		];
		return isset( $map[ $slug ] ) ? $map[ $slug ] : $map['zh'];
	}
}

if ( ! function_exists( 'vt_news_build_query' ) ) {
	function vt_news_build_query( $keyword ) {
		$keyword = trim( (string) $keyword );
		$profile = vt_news_language_profile();
		$suffix  = trim( (string) ( $profile['suffix'] ?? 'VTuber' ) );
		if ( '' === $keyword ) {
			return $suffix;
		}
		return $keyword . ' ' . $suffix;
	}
}

/**
 * Fetch news items for a keyword (VTuber name).
 *
 * @param string $keyword Name/keyword to search.
 * @param int    $limit   Number of items.
 * @param bool   $force_refresh Bypass transient cache.
 * @return array
 */
function vt_news_fetch_items( $keyword, $limit = 5, $force_refresh = false ) {
	$keyword = trim( $keyword );
	if ( ! $keyword ) {
		return [];
	}

	$profile       = vt_news_language_profile();
	$query         = vt_news_build_query( $keyword );
	$transient_key = 'vtnews_' . md5( $query . '|' . $limit . '|' . $profile['hl'] . '|' . $profile['gl'] );
	$cached        = get_transient( $transient_key );
	if ( ! $force_refresh && ! empty( $cached ) ) {
		return $cached;
	}

	// Frontend requests should never block on remote RSS fetches.
	// If cache is cold, return immediately and let cron warm the cache.
	if (
		! $force_refresh &&
		empty( $cached ) &&
		! is_admin() &&
		( ! function_exists( 'wp_doing_cron' ) || ! wp_doing_cron() )
	) {
		return [];
	}

	$url = add_query_arg(
		[
			'q'    => rawurlencode( $query ),
			'hl'   => (string) $profile['hl'],
			'gl'   => (string) $profile['gl'],
			'ceid' => (string) $profile['ceid'],
		],
		'https://news.google.com/rss/search'
	);

	$resp = wp_remote_get(
		$url,
		[
			'timeout' => 12,
			'headers' => [
				'User-Agent' => 'vt-news-aggregator/1.1 (+usadanews.com)',
			],
		]
	);
	if ( is_wp_error( $resp ) ) {
		return [];
	}
	$body = wp_remote_retrieve_body( $resp );
	if ( ! $body ) {
		return [];
	}

	$xml = @simplexml_load_string( $body );
	if ( ! $xml || empty( $xml->channel->item ) ) {
		return [];
	}

	$items = [];
	foreach ( $xml->channel->item as $item ) {
		$title = (string) $item->title;
		$link  = (string) $item->link;
		$date  = (string) $item->pubDate;
		$source = '';
		if ( isset( $item->source ) ) {
			$source = (string) $item->source;
		} elseif ( isset( $item->children( 'media', true )->credit ) ) {
			$source = (string) $item->children( 'media', true )->credit;
		} else {
			$host = wp_parse_url( $link, PHP_URL_HOST );
			$source = $host ? preg_replace( '#^www\\.#', '', $host ) : '';
		}
		$thumb = '';
		if ( isset( $item->children( 'media', true )->content ) ) {
			$media = $item->children( 'media', true )->content;
			if ( isset( $media['url'] ) ) {
				$thumb = (string) $media['url'];
			}
		}
		$items[] = [
			'title'  => wp_strip_all_tags( $title ),
			'link'   => esc_url_raw( $link ),
			'source' => wp_strip_all_tags( $source ),
			'date'   => $date ? date_i18n( 'Y/m/d H:i', strtotime( $date ) ) : '',
			'thumb'  => esc_url_raw( $thumb ),
		];
		if ( count( $items ) >= $limit ) {
			break;
		}
	}

	set_transient( $transient_key, $items, HOUR_IN_SECONDS * 2 );
	return $items;
}

if ( ! function_exists( 'vt_news_collect_keywords' ) ) {
	function vt_news_collect_keywords( $limit = 120 ) {
		$out = [];
		$q = new WP_Query(
			[
				'post_type'      => 'vtuber',
				'post_status'    => 'publish',
				'posts_per_page' => intval( $limit ),
				'orderby'        => 'modified',
				'order'          => 'DESC',
				'fields'         => 'ids',
				'no_found_rows'  => true,
			]
		);
		if ( $q->have_posts() ) {
			foreach ( $q->posts as $pid ) {
				$title = trim( (string) get_the_title( $pid ) );
				if ( '' === $title ) {
					continue;
				}
				$out[] = $title;
			}
			wp_reset_postdata();
		}
		$out[] = 'VTuber 台灣';
		$out[] = 'ホロライブ';
		$out[] = 'にじさんじ';
		$out = array_values( array_unique( array_filter( array_map( 'trim', $out ) ) ) );
		return $out;
	}
}

if ( ! function_exists( 'vt_news_refresh_cache_batch' ) ) {
	function vt_news_refresh_cache_batch( $batch = 20 ) {
		$keywords = vt_news_collect_keywords( 160 );
		$total    = count( $keywords );
		if ( $total <= 0 ) {
			vt_news_log( 'refresh skipped=no_keywords' );
			return [ 'ok' => 0, 'reason' => 'no_keywords' ];
		}

		$batch  = max( 5, min( 40, intval( $batch ) ) );
		$offset = intval( get_option( 'vt_news_refresh_offset', 0 ) );
		if ( $offset >= $total ) {
			$offset = 0;
		}

		$picked = [];
		for ( $i = 0; $i < $batch; $i++ ) {
			$idx = ( $offset + $i ) % $total;
			$kw  = (string) ( $keywords[ $idx ] ?? '' );
			if ( '' === $kw ) {
				continue;
			}
			$items = vt_news_fetch_items( $kw, 6, true );
			$picked[] = [ 'kw' => $kw, 'count' => is_array( $items ) ? count( $items ) : 0 ];
			usleep( 160000 );
		}

		$new_offset = ( $offset + $batch ) % $total;
		update_option( 'vt_news_refresh_offset', $new_offset, false );
		update_option( 'vt_news_last_refresh_utc', gmdate( 'c' ), false );
		update_option( 'vt_news_last_refresh_count', count( $picked ), false );

		$summary = [
			'ok'        => 1,
			'utc'       => gmdate( 'c' ),
			'batch'     => $batch,
			'total'     => $total,
			'offset'    => $offset,
			'next'      => $new_offset,
			'refreshed' => $picked,
		];
		$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
		}
		@file_put_contents( $dir . 'news-refresh-last.json', wp_json_encode( $summary, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
		vt_news_log( 'refresh batch=' . $batch . ' total=' . $total . ' offset=' . $offset . ' next=' . $new_offset );
		return $summary;
	}
}

if ( ! function_exists( 'vt_news_schedule_refresh' ) ) {
	function vt_news_schedule_refresh() {
		if ( ! wp_next_scheduled( 'vt_news_refresh_event' ) ) {
			wp_schedule_event( time() + 120, 'hourly', 'vt_news_refresh_event' );
		}
	}
	add_action( 'init', 'vt_news_schedule_refresh' );
	add_action( 'vt_news_refresh_event', function () {
		vt_news_refresh_cache_batch( 18 );
	} );
}

/**
 * Render news list.
 *
 * @param string $keyword VTuber name or keyword.
 * @param int    $limit   Max items.
 * @param string $heading Heading text.
 */
function vt_news_render_related( $keyword, $limit = 5, $heading = '' ) {
	$items = vt_news_fetch_items( $keyword, $limit );
	if ( empty( $items ) ) {
		return;
	}
	$heading = $heading ? $heading : __( '相關新聞（外部連結）', 'vtuber-portal' );
	?>
	<section class="vt-section vt-news-agg">
		<h2><?php echo esc_html( $heading ); ?></h2>
		<div class="vt-news-list">
			<?php foreach ( $items as $it ) : ?>
				<article class="vt-news-card">
					<a href="<?php echo esc_url( $it['link'] ); ?>" target="_blank" rel="noopener nofollow">
						<?php if ( $it['thumb'] ) : ?>
							<span class="vt-news-thumb"><img loading="lazy" decoding="async" src="<?php echo esc_url( $it['thumb'] ); ?>" alt="<?php echo esc_attr( $it['title'] ); ?>"></span>
						<?php endif; ?>
						<div class="vt-news-body">
							<div class="vt-news-title"><?php echo esc_html( $it['title'] ); ?></div>
							<div class="vt-news-meta">
								<?php if ( $it['source'] ) : ?>
									<span class="vt-news-source"><?php echo esc_html( $it['source'] ); ?></span>
								<?php endif; ?>
								<?php if ( $it['date'] ) : ?>
									<span class="vt-news-date"><?php echo esc_html( $it['date'] ); ?></span>
								<?php endif; ?>
							</div>
						</div>
					</a>
				</article>
			<?php endforeach; ?>
		</div>
		<p class="vt-news-note"><?php esc_html_e( '僅引用標題與來源，點擊後前往原網站閱讀全文。', 'vtuber-portal' ); ?></p>
	</section>
	<style>
		.vt-news-agg .vt-news-list { display:grid; gap:12px; }
		.vt-news-card { background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; overflow:hidden; }
		.vt-news-card a { display:flex; gap:12px; padding:12px; text-decoration:none; color:inherit; align-items:center; }
		.vt-news-thumb img { width:88px; height:88px; object-fit:cover; border-radius:10px; }
		.vt-news-title { font-weight:600; margin-bottom:4px; }
		.vt-news-meta { font-size:12px; opacity:0.8; display:flex; gap:8px; flex-wrap:wrap; }
		.vt-news-note { font-size:12px; opacity:0.6; }
		@media (max-width: 640px) {
			.vt-news-card a { flex-direction:column; align-items:flex-start; }
			.vt-news-thumb img { width:100%; height:auto; }
		}
	</style>
	<?php
}
