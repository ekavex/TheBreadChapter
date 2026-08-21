package com.thebreadchapter.pos

import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class LogActivity : AppCompatActivity() {

    private lateinit var tvLogs: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_log)

        tvLogs = findViewById(R.id.tvLogs)
        val btnClear = findViewById<Button>(R.id.btnClearLogs)
        val btnClose = findViewById<Button>(R.id.btnCloseLogs)

        updateLogs()

        AppLogManager.onLogUpdate = {
            runOnUiThread { updateLogs() }
        }

        btnClear.setOnClickListener {
            AppLogManager.clear()
        }

        btnClose.setOnClickListener {
            finish()
        }
    }

    private fun updateLogs() {
        val logs = AppLogManager.getLogs()
        tvLogs.text = if (logs.isEmpty()) "No logs yet..." else logs
    }

    override fun onDestroy() {
        AppLogManager.onLogUpdate = null
        super.onDestroy()
    }
}
