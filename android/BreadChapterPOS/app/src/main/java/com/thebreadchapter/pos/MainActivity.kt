package com.thebreadchapter.pos

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.*
import android.widget.ImageButton
import android.widget.Toast
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
        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView, request: WebResourceRequest, error: WebResourceError,
            ) {
                if (request.isForMainFrame) {
                    view.loadData(
                        """<html><body style='font-family:sans-serif;padding:40px;'>
                            <h2>Cannot reach server</h2>
                            <p>${error.description}</p>
                            <p>Check your network and tap <b>Reload</b>.</p>
                            <button onclick='location.reload()'>Reload</button>
                        </body></html>""",
                        "text/html", "utf-8",
                    )
                }
            }
        }

        val prefs = getSharedPreferences(SettingsActivity.PREFS, MODE_PRIVATE)
        val serverUrl = prefs.getString(
            SettingsActivity.KEY_SERVER_URL,
            "https://automation.thebreadchapter.in",
        ) ?: "https://automation.thebreadchapter.in"
        webView.loadUrl(serverUrl)
    }

    private fun setupSettingsButton() {
        val btn = findViewById<ImageButton>(R.id.btnSettings)
        btn.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        // Hide button after 5 seconds — reduces distraction during service
        btn.postDelayed({ btn.visibility = View.GONE }, 5_000)
        // Triple-tap anywhere on screen reveals settings (for staff)
        var tapCount = 0
        webView.setOnLongClickListener {
            tapCount++
            if (tapCount >= 1) {
                tapCount = 0
                btn.visibility = View.VISIBLE
                btn.postDelayed({ btn.visibility = View.GONE }, 5_000)
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

    override fun onDestroy() {
        // Keep service running even if activity closes
        super.onDestroy()
    }
}
