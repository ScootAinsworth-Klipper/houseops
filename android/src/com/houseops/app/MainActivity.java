package com.scoot.houseops;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private static final String PREFS_NAME = "HouseOpsPrefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String DEFAULT_URL = "http://192.168.1.82:8088";
    private static final String GITHUB_REPO_API = "https://api.github.com/repos/ScootAinsworth-Klipper/houseops/releases/latest";
    private static final int FILECHOOSER_RESULTCODE = 1001;

    private WebView webView;
    private FrameLayout rootLayout;
    private LinearLayout errorView;
    private TextView errorText;
    private ValueCallback<Uri[]> uploadMessage;
    private String currentServerUrl;
    private long downloadId = -1;

    private final BroadcastReceiver downloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (id != -1 && id == downloadId) {
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) {
                    Uri uri = dm.getUriForDownloadedFile(id);
                    if (uri != null) {
                        Intent installIntent = new Intent(Intent.ACTION_VIEW);
                        installIntent.setDataAndType(uri, "application/vnd.android.package-archive");
                        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        try {
                            startActivity(installIntent);
                        } catch (Exception e) {
                            Toast.makeText(context, "Please allow 'Install unknown apps' for HouseOps in Settings", Toast.LENGTH_LONG).show();
                        }
                    }
                }
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // AMOLED Fullscreen & Deep Black System Bars
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window window = getWindow();
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.BLACK);
            window.setNavigationBarColor(Color.BLACK);
        }

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        currentServerUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_URL);

        rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(Color.BLACK);

        setupWebView();
        setupErrorView();

        rootLayout.addView(webView);
        rootLayout.addView(errorView);
        setContentView(rootLayout);

        // Register Download Receiver
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(downloadReceiver, filter);
        }

        loadHouseOps();

        // Check for updates in background
        checkForUpdates(false);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        try {
            unregisterReceiver(downloadReceiver);
        } catch (Exception ignored) {}
    }

    private void setupWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setDisplayZoomControls(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                errorView.setVisibility(View.GONE);
                webView.setVisibility(View.VISIBLE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError("Unable to connect to HouseOps at\n" + currentServerUrl);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (uploadMessage != null) {
                    uploadMessage.onReceiveValue(null);
                    uploadMessage = null;
                }
                uploadMessage = filePathCallback;

                try {
                    Intent intent = fileChooserParams.createIntent();
                    startActivityForResult(intent, FILECHOOSER_RESULTCODE);
                } catch (Exception e) {
                    Intent pickIntent = new Intent(Intent.ACTION_GET_CONTENT);
                    pickIntent.setType("image/*");
                    Intent cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    Intent chooser = Intent.createChooser(pickIntent, "Capture Verification Photo");
                    chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cameraIntent});
                    startActivityForResult(chooser, FILECHOOSER_RESULTCODE);
                }
                return true;
            }
        });

        webView.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                showServerConfigDialog();
                return true;
            }
        });
    }

    private void setupErrorView() {
        errorView = new LinearLayout(this);
        errorView.setOrientation(LinearLayout.VERTICAL);
        errorView.setGravity(Gravity.CENTER);
        errorView.setBackgroundColor(Color.BLACK);
        errorView.setPadding(40, 40, 40, 40);
        errorView.setVisibility(View.GONE);

        errorText = new TextView(this);
        errorText.setTextColor(Color.parseColor("#94a3b8"));
        errorText.setTextSize(16);
        errorText.setGravity(Gravity.CENTER);
        errorText.setText("Connecting to HouseOps...");
        errorView.addView(errorText);

        Button btnRetry = new Button(this);
        btnRetry.setText("🔄 Tap to Retry");
        btnRetry.setTextColor(Color.WHITE);
        btnRetry.setBackgroundColor(Color.parseColor("#1e293b"));
        LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        btnParams.setMargins(0, 30, 0, 0);
        btnRetry.setLayoutParams(btnParams);
        btnRetry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                loadHouseOps();
            }
        });
        errorView.addView(btnRetry);

        Button btnSettings = new Button(this);
        btnSettings.setText("⚙️ App Settings & Updates");
        btnSettings.setTextColor(Color.parseColor("#38bdf8"));
        btnSettings.setBackgroundColor(Color.TRANSPARENT);
        btnSettings.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showServerConfigDialog();
            }
        });
        errorView.addView(btnSettings);
    }

    private void loadHouseOps() {
        errorView.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        webView.loadUrl(currentServerUrl);
    }

    private void showError(String msg) {
        webView.setVisibility(View.GONE);
        errorText.setText(msg);
        errorView.setVisibility(View.VISIBLE);
    }

    private void showServerConfigDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("⚡ HouseOps Settings");

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(50, 20, 50, 10);

        TextView lbl = new TextView(this);
        lbl.setText("Server URL (Pi IP or Hostname):");
        lbl.setTextColor(Color.GRAY);
        layout.addView(lbl);

        final EditText input = new EditText(this);
        input.setText(currentServerUrl);
        layout.addView(input);

        // Action Buttons inside Settings
        Button btnTestVoice = new Button(this);
        btnTestVoice.setText("📢 Test Voice Broadcast (All Rooms)");
        btnTestVoice.setTextColor(Color.parseColor("#38bdf8"));
        btnTestVoice.setBackgroundColor(Color.parseColor("#1e293b"));
        LinearLayout.LayoutParams btnVoiceParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        btnVoiceParams.setMargins(0, 30, 0, 10);
        btnTestVoice.setLayoutParams(btnVoiceParams);
        btnTestVoice.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                triggerVoiceTest();
            }
        });
        layout.addView(btnTestVoice);

        Button btnCheckUpdate = new Button(this);
        btnCheckUpdate.setText("🚀 Check for App Updates");
        btnCheckUpdate.setTextColor(Color.parseColor("#94a3b8"));
        btnCheckUpdate.setBackgroundColor(Color.parseColor("#0f172a"));
        LinearLayout.LayoutParams btnUpParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        btnUpParams.setMargins(0, 10, 0, 10);
        btnCheckUpdate.setLayoutParams(btnUpParams);
        btnCheckUpdate.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                checkForUpdates(true);
            }
        });
        layout.addView(btnCheckUpdate);

        builder.setView(layout);

        builder.setPositiveButton("Save & Connect", new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialog, int which) {
                String newUrl = input.getText().toString().trim();
                if (!newUrl.startsWith("http://") && !newUrl.startsWith("https://")) {
                    newUrl = "http://" + newUrl;
                }
                currentServerUrl = newUrl;
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .edit()
                        .putString(KEY_SERVER_URL, currentServerUrl)
                        .apply();
                loadHouseOps();
            }
        });

        builder.setNegativeButton("Close", null);
        builder.show();
    }

    private void triggerVoiceTest() {
        Toast.makeText(this, "📢 Broadcasting test across All Rooms...", Toast.LENGTH_SHORT).show();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    URL url = new URL(currentServerUrl + "/api/announce");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(5000);
                    conn.setReadTimeout(5000);

                    JSONObject body = new JSONObject();
                    body.put("message", "Hello! HouseOps voice broadcast is operational across all rooms.");
                    body.put("speaker", "All Rooms");

                    byte[] out = body.toString().getBytes("UTF-8");
                    conn.getOutputStream().write(out);

                    final int code = conn.getResponseCode();
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (code == 200) {
                                Toast.makeText(MainActivity.this, "✅ Spoken broadcast sent!", Toast.LENGTH_SHORT).show();
                            } else {
                                Toast.makeText(MainActivity.this, "❌ Failed (HTTP " + code + ")", Toast.LENGTH_SHORT).show();
                            }
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            Toast.makeText(MainActivity.this, "Error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                        }
                    });
                }
            }
        }).start();
    }

    // --- GitHub In-App Updater ---
    private void checkForUpdates(final boolean isManual) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    URL url = new URL(GITHUB_REPO_API);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestProperty("User-Agent", "HouseOps-Android-App");
                    conn.setRequestProperty("Accept", "application/vnd.github.v3+json");
                    conn.setConnectTimeout(8000);
                    conn.setReadTimeout(8000);

                    int respCode = conn.getResponseCode();
                    if (respCode == 200) {
                        BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = reader.readLine()) != null) {
                            sb.append(line);
                        }
                        reader.close();

                        JSONObject json = new JSONObject(sb.toString());
                        final String tagName = json.optString("tag_name", "");
                        final String body = json.optString("body", "");
                        JSONArray assets = json.optJSONArray("assets");

                        String downloadUrl = null;
                        if (assets != null) {
                            for (int i = 0; i < assets.length(); i++) {
                                JSONObject asset = assets.getJSONObject(i);
                                if (asset.optString("name", "").endsWith(".apk")) {
                                    downloadUrl = asset.optString("browser_download_url");
                                    break;
                                }
                            }
                        }

                        final String finalDownloadUrl = downloadUrl;
                        PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
                        final String currentVer = pInfo.versionName;

                        if (isNewerVersion(tagName, currentVer) && finalDownloadUrl != null) {
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    showUpdateDialog(tagName, body, finalDownloadUrl);
                                }
                            });
                        } else if (isManual) {
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    Toast.makeText(MainActivity.this, "HouseOps is up to date (" + currentVer + ")", Toast.LENGTH_SHORT).show();
                                }
                            });
                        }
                    } else if (isManual) {
                        final int finalResp = respCode;
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                Toast.makeText(MainActivity.this, "Check failed (HTTP " + finalResp + ")", Toast.LENGTH_SHORT).show();
                            }
                        });
                    }
                } catch (final Exception e) {
                    if (isManual) {
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                Toast.makeText(MainActivity.this, "Update check error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                            }
                        });
                    }
                }
            }
        }).start();
    }

    private boolean isNewerVersion(String latestTag, String currentVer) {
        if (latestTag == null || currentVer == null) return false;
        String v1 = latestTag.replace("v", "").trim();
        String v2 = currentVer.replace("v", "").trim();
        String[] parts1 = v1.split("\\.");
        String[] parts2 = v2.split("\\.");
        int len = Math.max(parts1.length, parts2.length);
        for (int i = 0; i < len; i++) {
            int p1 = i < parts1.length ? Integer.parseInt(parts1[i].replaceAll("\\D+", "0")) : 0;
            int p2 = i < parts2.length ? Integer.parseInt(parts2[i].replaceAll("\\D+", "0")) : 0;
            if (p1 > p2) return true;
            if (p1 < p2) return false;
        }
        return false;
    }

    private void showUpdateDialog(final String tagName, String changelog, final String downloadUrl) {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("🚀 Update Available: " + tagName);

        String message = (changelog != null && !changelog.isEmpty())
                ? changelog + "\n\nDo you want to download and install this update?"
                : "A new version of HouseOps is ready on GitHub.\n\nDo you want to download and install this update?";
        builder.setMessage(message);

        builder.setPositiveButton("Download & Install", new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialog, int which) {
                startDownload(tagName, downloadUrl);
            }
        });

        builder.setNegativeButton("Later", null);
        builder.show();
    }

    private void startDownload(String tagName, String downloadUrl) {
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(downloadUrl));
            request.setTitle("HouseOps " + tagName);
            request.setDescription("Downloading HouseOps update from GitHub...");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "HouseOps-" + tagName + ".apk");
            request.setMimeType("application/vnd.android.package-archive");

            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm != null) {
                downloadId = dm.enqueue(request);
                Toast.makeText(this, "Downloading HouseOps " + tagName + "... Check notification shade.", Toast.LENGTH_LONG).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, "Download error: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILECHOOSER_RESULTCODE) {
            if (uploadMessage == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                String dataString = data.getDataString();
                if (dataString != null) {
                    results = new Uri[]{Uri.parse(dataString)};
                } else if (data.getClipData() != null) {
                    int numSelected = data.getClipData().getItemCount();
                    results = new Uri[numSelected];
                    for (int i = 0; i < numSelected; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                }
            }
            uploadMessage.onReceiveValue(results);
            uploadMessage = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
