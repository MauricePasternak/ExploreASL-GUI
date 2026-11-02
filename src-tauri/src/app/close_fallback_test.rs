use super::*;

#[test]
fn native_handled_event_cancels_only_a_valid_matching_request() {
    let app = tauri::test::mock_builder()
        .manage(CloseFallback::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let window =
        tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::App("index.html".into()))
            .build()
            .unwrap();
    install(&window);
    let fallback = app.state::<CloseFallback>();
    let request = fallback.request().unwrap();
    window
        .emit_to("main", "app-close-handled", request)
        .unwrap();
    assert!(!fallback.timed_out(request));

    let current = fallback.request().unwrap();
    window
        .emit_to("main", "app-close-handled", "invalid")
        .unwrap();
    assert!(fallback.timed_out(current));
}

#[test]
fn one_close_reaches_native_confirmation_without_any_renderer_response() {
    let fallback = CloseFallback::default();
    let request = fallback.request().unwrap();
    assert!(fallback.timed_out(request));
    assert!(!fallback.timed_out(request));
    assert!(fallback.request().is_none());
}

#[test]
fn handled_close_suppresses_fallback_without_cancelling_a_later_request() {
    let fallback = CloseFallback::default();
    let old = fallback.request().unwrap();
    fallback.handled(old);
    assert!(!fallback.timed_out(old));

    let current = fallback.request().unwrap();
    assert_ne!(old, current);
    fallback.handled(old);
    assert!(!fallback.timed_out(old));
    assert!(fallback.timed_out(current));
}

#[test]
fn repeated_clicks_do_not_restart_the_deadline_or_duplicate_the_dialog() {
    let fallback = CloseFallback::default();
    let request = fallback.request().unwrap();
    for _ in 0..300 {
        assert!(fallback.request().is_none());
    }
    assert!(fallback.timed_out(request));
    fallback.handled(request);
    assert!(fallback.request().is_none());
}

#[test]
fn cancel_or_failed_shutdown_allows_retry_and_ignores_expired_timers() {
    let fallback = CloseFallback::default();
    let old = fallback.request().unwrap();
    assert!(fallback.timed_out(old));
    fallback.reset();
    let current = fallback.request().unwrap();
    assert!(!fallback.timed_out(old));
    assert!(fallback.timed_out(current));
}
