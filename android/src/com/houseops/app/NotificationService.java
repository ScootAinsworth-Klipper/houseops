package com.scoot.houseops;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class NotificationService extends Service {
    public static final String CHANNEL_MONITOR = "houseops_monitor";
    public static final String CHANNEL_ALERTS = "houseops_alerts";
    private static final int NOTIF_ID_ONGOING = 4001;
    private static int alertNotifId = 5000;

    private Handler handler;
    private ExecutorService executor;
    private volatile boolean running = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        handler = new Handler(Looper.getMainLooper());
        executor = Executors.newSingleThreadExecutor();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences("HouseOpsPrefs", Context.MODE_PRIVATE);
        String profile = prefs.getString("user_profile", "Dad");
        Notification ongoing = buildOngoingNotification(profile);
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIF_ID_ONGOING, ongoing, 1); // FOREGROUND_SERVICE_TYPE_DATA_SYNC = 1
            } else {
                startForeground(NOTIF_ID_ONGOING, ongoing);
            }
        } catch (Exception e) {
            try {
                startForeground(NOTIF_ID_ONGOING, ongoing);
            } catch (Exception ignored) {}
        }

        if (!running) {
            running = true;
            scheduleNextPoll(1500);
        } else {
            // Trigger an immediate poll when profile changes or service restarts
            if (executor != null && !executor.isShutdown()) {
                executor.execute(new Runnable() {
                    @Override
                    public void run() {
                        pollNotifications();
                    }
                });
            }
        }
        return START_STICKY;
    }

    private void scheduleNextPoll(long delayMs) {
        if (!running || handler == null) return;
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!running) return;
                if (executor != null && !executor.isShutdown()) {
                    executor.execute(new Runnable() {
                        @Override
                        public void run() {
                            pollNotifications();
                        }
                    });
                }
                scheduleNextPoll(10000);
            }
        }, delayMs);
    }

    private void pollNotifications() {
        HttpURLConnection conn = null;
        try {
            SharedPreferences prefs = getSharedPreferences("HouseOpsPrefs", Context.MODE_PRIVATE);
            String serverUrl = prefs.getString("server_url", "http://192.168.1.82:8088");
            String profile = prefs.getString("user_profile", "Dad");
            long lastSeenTs = prefs.getLong("last_notif_ts", 0L);

            String endpoint = serverUrl + "/api/notifications?profile=" + Uri.encode(profile) + "&since=" + lastSeenTs;
            URL url = new URL(endpoint);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(4500);
            conn.setReadTimeout(4500);

            if (conn.getResponseCode() == 200) {
                BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line);
                }
                br.close();

                JSONObject root = new JSONObject(sb.toString());
                long serverTime = root.optLong("serverTime", System.currentTimeMillis());

                // First run or profile switch: baseline to serverTime so we don't replay old history
                if (lastSeenTs == 0L) {
                    prefs.edit().putLong("last_notif_ts", serverTime).apply();
                    return;
                }

                JSONArray items = root.optJSONArray("notifications");
                long maxTs = lastSeenTs;
                if (items != null && items.length() > 0) {
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject item = items.getJSONObject(i);
                        long createdAt = item.optLong("createdAt", 0L);
                        String title = item.optString("title", "HouseOps");
                        String body = item.optString("body", "");
                        String tab = item.optString("tab", "active");

                        if (createdAt > lastSeenTs) {
                            sendAlertNotification(title, body, tab);
                            if (createdAt > maxTs) {
                                maxTs = createdAt;
                            }
                        }
                    }
                    prefs.edit().putLong("last_notif_ts", maxTs).apply();
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private Notification buildOngoingNotification(String profile) {
        Intent i = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b = new Notification.Builder(this, CHANNEL_MONITOR);
        } else {
            b = new Notification.Builder(this).setPriority(Notification.PRIORITY_MIN);
        }
        b.setContentTitle("HouseOps Active (" + profile + ")")
         .setContentText("Connected to household chore & photo alerts")
         .setSmallIcon(R.drawable.icon)
         .setContentIntent(pi)
         .setOngoing(true);
        return b.build();
    }

    private void sendAlertNotification(String title, String body, String tab) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Intent i = new Intent(this, MainActivity.class);
        i.putExtra("tab", tab);
        i.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int reqCode = alertNotifId++;
        PendingIntent pi = PendingIntent.getActivity(this, reqCode, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b = new Notification.Builder(this, CHANNEL_ALERTS);
        } else {
            b = new Notification.Builder(this)
                    .setPriority(Notification.PRIORITY_HIGH)
                    .setDefaults(Notification.DEFAULT_ALL);
        }
        b.setContentTitle(title)
         .setContentText(body)
         .setStyle(new Notification.BigTextStyle().bigText(body))
         .setSmallIcon(R.drawable.icon)
         .setContentIntent(pi)
         .setAutoCancel(true);
        nm.notify(reqCode, b.build());
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            NotificationChannel monitor = new NotificationChannel(
                    CHANNEL_MONITOR, "HouseOps Background Sync", NotificationManager.IMPORTANCE_MIN);
            monitor.setDescription("Keeps device connected to Raspberry Pi chore alerts");
            monitor.setShowBadge(false);
            nm.createNotificationChannel(monitor);

            NotificationChannel alerts = new NotificationChannel(
                    CHANNEL_ALERTS, "HouseOps Chore & Photo Alerts", NotificationManager.IMPORTANCE_HIGH);
            alerts.setDescription("Instant notifications for chores, nudges, and verification photos");
            alerts.enableVibration(true);
            nm.createNotificationChannel(alerts);
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (executor != null) executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
