package com.scoot.houseops;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
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

public class MainActivity extends Activity {
    private static final String PREFS_NAME = "HouseOpsPrefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String DEFAULT_URL = "http://192.168.1.82:8088";
    private static final int FILECHOOSER_RESULTCODE = 1001;

    private WebView webView;
    private FrameLayout rootLayout;
    private LinearLayout errorView;
    private TextView errorText;
    private ValueCallback<Uri[]> uploadMessage;
    private String currentServerUrl;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // AMOLED Fullscreen & Black System Bars
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

        loadHouseOps();
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

        // Hardware acceleration & debugging
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
                    // Fallback to generic image picker / camera
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

        // Long press anywhere with 2 fingers or top bar can trigger settings
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
        btnSettings.setText("⚙️ Change Server Address");
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
        builder.setTitle("HouseOps Server Address");

        final EditText input = new EditText(this);
        input.setText(currentServerUrl);
        builder.setView(input);

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

        builder.setNegativeButton("Cancel", null);
        builder.show();
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
