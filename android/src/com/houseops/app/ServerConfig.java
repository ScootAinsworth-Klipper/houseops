package com.scoot.houseops;

import android.content.Context;
import android.content.SharedPreferences;

import java.net.HttpURLConnection;
import java.net.URL;

public final class ServerConfig {
    public static final String PREFS_NAME = "HouseOpsPrefs";
    public static final String KEY_LOCAL_URL = "server_url";
    public static final String KEY_REMOTE_URL = "remote_url";
    public static final String KEY_ACCESS_KEY = "access_key";
    public static final String KEY_ACTIVE_URL = "last_active_url";

    public static final String DEFAULT_LOCAL_URL = "http://192.168.1.82:8088";
    public static final String DEFAULT_REMOTE_URL = "https://ainsworth.ddns.net";

    private ServerConfig() {}

    public static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static String normalizeUrl(String raw, String defaultScheme) {
        if (raw == null) return "";
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) return "";
        if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
            trimmed = defaultScheme + trimmed;
        }
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }

    public static String getLocalUrl(Context ctx) {
        String raw = prefs(ctx).getString(KEY_LOCAL_URL, DEFAULT_LOCAL_URL);
        return normalizeUrl(raw, "http://");
    }

    public static String getRemoteUrl(Context ctx) {
        String raw = prefs(ctx).getString(KEY_REMOTE_URL, DEFAULT_REMOTE_URL);
        return normalizeUrl(raw, "https://");
    }

    public static String getAccessKey(Context ctx) {
        String raw = prefs(ctx).getString(KEY_ACCESS_KEY, "");
        return raw == null ? "" : raw.trim();
    }

    public static String getFastBaseUrl(Context ctx) {
        String cached = prefs(ctx).getString(KEY_ACTIVE_URL, "");
        if (cached != null && !cached.trim().isEmpty()) {
            return cached.trim();
        }
        String local = getLocalUrl(ctx);
        if (!local.isEmpty()) return local;
        String remote = getRemoteUrl(ctx);
        return remote.isEmpty() ? DEFAULT_LOCAL_URL : remote;
    }

    public static void clearActiveCache(Context ctx) {
        prefs(ctx).edit().remove(KEY_ACTIVE_URL).apply();
    }

    public static boolean isHealthy(String baseUrl, int timeoutMs) {
        if (baseUrl == null || baseUrl.isEmpty()) return false;
        HttpURLConnection conn = null;
        try {
            URL url = new URL(baseUrl + "/api/health");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            return conn.getResponseCode() == 200;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    public static String resolveServerUrl(Context ctx) {
        String local = getLocalUrl(ctx);
        String remote = getRemoteUrl(ctx);

        if (!local.isEmpty() && isHealthy(local, 1000)) {
            prefs(ctx).edit().putString(KEY_ACTIVE_URL, local).apply();
            return local;
        }
        if (!remote.isEmpty()) {
            prefs(ctx).edit().putString(KEY_ACTIVE_URL, remote).apply();
            return remote;
        }
        String fallback = local.isEmpty() ? DEFAULT_LOCAL_URL : local;
        prefs(ctx).edit().putString(KEY_ACTIVE_URL, fallback).apply();
        return fallback;
    }
}
