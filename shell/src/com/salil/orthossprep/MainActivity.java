package com.salil.orthossprep;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** WebView shell for Ortho preSSaleel: loads the bundled app and supports the file picker. */
public class MainActivity extends Activity {
    private static final int PICK = 7;
    private ValueCallback<Uri[]> pending;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(1);
        WebView wv = new WebView(this);
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        wv.setWebViewClient(new WebViewClient());
        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pending != null) pending.onReceiveValue(null);
                pending = callback;
                try {
                    Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/pdf", "text/plain"});
                    startActivityForResult(Intent.createChooser(i, "Choose a PDF or text file"), PICK);
                    return true;
                } catch (Exception e) {
                    pending = null;
                    return false;
                }
            }
        });
        setContentView(wv);
        wv.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == PICK) {
            if (pending != null) {
                pending.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                pending = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }
}
