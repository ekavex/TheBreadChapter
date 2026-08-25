package com.thebreadchapter.pos

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.webkit.*
import android.widget.ImageButton
import android.widget.Toast
import org.json.JSONObject
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    private val btPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { perms ->
        val allGranted = perms.values.all { it }
        if (allGranted) startPrintBridge()
        else Toast.makeText(this, "Bluetooth permission needed for printing", Toast.LENGTH_LONG).show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        setupWebView()
        setupSettingsButton()
        requestBluetoothPermissions()
    }

    private fun setupWebView() {
        webView = findViewById(R.id.webView)

        // Accept cookies and persist them to disk so "keep me signed in" survives app restarts.
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.settings.apply {
            @SuppressLint("SetJavaScriptEnabled")
            javaScriptEnabled     = true
            domStorageEnabled     = true
            databaseEnabled       = true
            loadWithOverviewMode  = true
            useWideViewPort       = true
            builtInZoomControls   = false
            displayZoomControls   = false
            setSupportZoom(false)
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }
        // Expose Pine Labs AppToApp bridge to the web app.
        webView.addJavascriptInterface(
            PinePaymentBridge(webView, application as BreadChapterApp),
            "AndroidPinePayment",
        )

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                if (url.contains("/login")) {
                    val p = getSharedPreferences(SettingsActivity.PREFS, MODE_PRIVATE)
                    val user = p.getString(SettingsActivity.KEY_AUTO_LOGIN_USER, "").orEmpty().trim()
                    val pass = p.getString(SettingsActivity.KEY_AUTO_LOGIN_PASS, "").orEmpty()
                    if (user.isNotEmpty() && pass.isNotEmpty()) {
                        val body = JSONObject()
                        body.put("userId", user)
                        body.put("password", pass)
                        body.put("rememberMe", true)
                        val bodyJson = body.toString()
                        val script = """
                            (function(){
                                fetch('/api/auth/login',{
                                    method:'POST',
                                    headers:{'Content-Type':'application/json'},
                                    body:${JSONObject.quote(bodyJson)}
                                }).then(function(r){return r.json();}).then(function(d){
                                    if(d&&d.data&&d.data.role)window.location.href='/pos';
                                }).catch(function(){});
                            })();
                        """.trimIndent()
                        view.evaluateJavascript(script, null)
                    }
                }
            }

            override fun onReceivedError(
                view: WebView, request: WebResourceRequest, error: WebResourceError,
            ) {
                if (request.isForMainFrame) {
                    val targetUrl = request.url.toString()
                    view.loadData(
                        """<html><body style='font-family:sans-serif;padding:40px;text-align:center;'>
                            <h2 style='color:#333'>Cannot reach server</h2>
                            <p style='color:#666'>${error.description}</p>
                            <p style='color:#666'>Check your network connection and tap Reload.</p>
                            <button onclick='window.location.href="$targetUrl"'
                              style='margin-top:16px;padding:12px 28px;font-size:16px;background:#1a1a1a;color:#fff;border:none;border-radius:12px;cursor:pointer;'>
                              Reload
                            </button>
                        </body></html>""",
                        "text/html", "utf-8",
                    )
                }
            }
        }

        // Hand file downloads (CSV / Excel / PDF exports) to Android DownloadManager.
        // Without this, WebView navigates to the URL and shows a blank page.
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mimeType)
                // Pass the session cookie so the server accepts the authenticated request.
                val cookie = CookieManager.getInstance().getCookie(url)
                if (!cookie.isNullOrBlank()) addRequestHeader("Cookie", cookie)
                addRequestHeader("User-Agent", userAgent)
                setTitle(fileName)
                setDescription("Downloading…")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            }
            val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
            dm.enqueue(request)
            Toast.makeText(this, "Downloading $fileName…", Toast.LENGTH_SHORT).show()
        }

        val prefs = getSharedPreferences(SettingsActivity.PREFS, MODE_PRIVATE)
        val serverUrl = prefs.getString(
            SettingsActivity.KEY_SERVER_URL,
            "https://automation.thebreadchapter.in",
        ) ?: "https://automation.thebreadchapter.in"
        webView.loadUrl(serverUrl)
    }

    private fun setupSettingsButton() {
        val layout = findViewById<View>(R.id.layoutControls)
        val btnSettings = findViewById<ImageButton>(R.id.btnSettings)
        val btnLogs = findViewById<ImageButton>(R.id.btnLogs)

        btnSettings.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        btnLogs.setOnClickListener {
            startActivity(Intent(this, LogActivity::class.java))
        }

        // Hide controls after 5 seconds
        layout.postDelayed({ layout.visibility = View.GONE }, 5_000)

        // Triple-tap reveals controls
        var tapCount = 0
        webView.setOnLongClickListener {
            tapCount++
            if (tapCount >= 1) {
                tapCount = 0
                layout.visibility = View.VISIBLE
                layout.postDelayed({ layout.visibility = View.GONE }, 5_000)
            }
            true
        }
    }

    private fun requestBluetoothPermissions() {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if ((ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT)
                != PackageManager.PERMISSION_GRANTED)) {
                needed.add(Manifest.permission.BLUETOOTH_CONNECT)
            }
            if ((ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN)
                != PackageManager.PERMISSION_GRANTED)) {
                needed.add(Manifest.permission.BLUETOOTH_SCAN)
            }
        }
        if (needed.isEmpty()) startPrintBridge()
        else btPermissionLauncher.launch(needed.toTypedArray())
    }

    private fun startPrintBridge() {
        val bm = getSystemService(BLUETOOTH_SERVICE) as BluetoothManager
        if (bm.adapter == null) {
            Toast.makeText(this, "No Bluetooth hardware found", Toast.LENGTH_LONG).show()
            return
        }
        if ((Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) &&
            (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT)
            != PackageManager.PERMISSION_GRANTED)) return

        startService(Intent(this, PrintBridgeService::class.java))
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onPause() {
        super.onPause()
        // Write cookies to disk so the 30-day session survives app restarts.
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        // Keep service running even if activity closes
        super.onDestroy()
    }
}
