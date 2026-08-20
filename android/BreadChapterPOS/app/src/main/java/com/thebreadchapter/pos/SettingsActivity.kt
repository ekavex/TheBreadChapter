package com.thebreadchapter.pos

import android.content.Intent
import android.os.Bundle
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.edit

class SettingsActivity : AppCompatActivity() {

    companion object {
        const val PREFS            = "pos_prefs"
        const val KEY_SERVER_URL   = "server_url"
        const val KEY_STATION      = "station"
        const val KEY_PRINTER_MAC  = "printer_mac"
        const val KEY_BRIDGE_TOKEN = "bridge_token"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)

        val etUrl     = findViewById<EditText>(R.id.etServerUrl)
        val spStation = findViewById<Spinner>(R.id.spStation)
        val etMac     = findViewById<EditText>(R.id.etPrinterMac)
        val etToken   = findViewById<EditText>(R.id.etBridgeToken)
        val btnSave   = findViewById<Button>(R.id.btnSave)

        // Station spinner
        val stationValues = resources.getStringArray(R.array.station_values)
        val stationAdapter = ArrayAdapter.createFromResource(
            this, R.array.station_entries, android.R.layout.simple_spinner_item,
        )
        stationAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spStation.adapter = stationAdapter

        // Load saved prefs
        etUrl.setText(prefs.getString(KEY_SERVER_URL, "https://automation.thebreadchapter.in"))
        val savedStation = prefs.getString(KEY_STATION, "kitchen")
        spStation.setSelection(stationValues.indexOf(savedStation).coerceAtLeast(0))
        etMac.setText(prefs.getString(KEY_PRINTER_MAC, ""))
        etToken.setText(prefs.getString(KEY_BRIDGE_TOKEN, ""))

        btnSave.setOnClickListener {
            val url   = etUrl.text.toString().trimEnd('/')
            val mac   = etMac.text.toString().trim().uppercase()
            val token = etToken.text.toString().trim()
            val station = stationValues[spStation.selectedItemPosition]

            if (url.isBlank() || mac.isBlank() || token.isBlank()) {
                Toast.makeText(this, "All fields are required", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            prefs.edit {
                putString(KEY_SERVER_URL, url)
                putString(KEY_STATION, station)
                putString(KEY_PRINTER_MAC, mac)
                putString(KEY_BRIDGE_TOKEN, token)
            }

            // Restart the print bridge with new settings
            stopService(Intent(this, PrintBridgeService::class.java))
            startService(Intent(this, PrintBridgeService::class.java))

            Toast.makeText(this, "Saved. Bridge restarted.", Toast.LENGTH_SHORT).show()
            finish()
        }
    }
}
