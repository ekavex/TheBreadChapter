package com.thebreadchapter.pos

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.edit
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.UUID

class SettingsActivity : AppCompatActivity() {

    companion object {
        const val PREFS              = "pos_prefs"
        const val KEY_SERVER_URL     = "server_url"
        const val KEY_STATION        = "station"
        const val KEY_KITCHEN_MAC    = "kitchen_mac"
        const val KEY_BEVERAGE_MAC   = "beverage_mac"
        const val KEY_BRIDGE_TOKEN   = "bridge_token"
        // Pine Labs Application ID — provisioned by Pine Labs for this billing app
        const val KEY_PINE_APP_ID    = "pine_app_id"
        // Auto-login credentials stored for POS kiosk convenience
        const val KEY_AUTO_LOGIN_USER = "auto_login_user"
        const val KEY_AUTO_LOGIN_PASS = "auto_login_pass"

        private val SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

        // Known default printers
        private const val DEFAULT_KITCHEN_MAC = "66:22:34:20:A1:B3"
        private const val DEFAULT_BEVERAGE_MAC = "66:32:F7:C5:B7:05"
    }

    private data class PrinterDevice(val name: String, val mac: String) {
        override fun toString(): String = if (name == mac) mac else "$name ($mac)"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)

        val etUrl     = findViewById<EditText>(R.id.etServerUrl)
        val etStation = findViewById<EditText>(R.id.etStationFilter)
        val spKitchen = findViewById<Spinner>(R.id.spKitchenPrinter)
        val spBev     = findViewById<Spinner>(R.id.spBeveragePrinter)
        val etToken   = findViewById<EditText>(R.id.etBridgeToken)
        val etPineAppId = findViewById<EditText>(R.id.etPineAppId)
        val etAutoLoginUser = findViewById<EditText>(R.id.etAutoLoginUser)
        val etAutoLoginPass = findViewById<EditText>(R.id.etAutoLoginPass)

        val btnTestKitchen = findViewById<Button>(R.id.btnTestKitchen)
        val btnTestBev     = findViewById<Button>(R.id.btnTestBeverage)
        val btnSave        = findViewById<Button>(R.id.btnSave)

        // Populate Printer Spinners
        val printerList = getAvailablePrinters()
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, printerList)
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spKitchen.adapter = adapter
        spBev.adapter = adapter

        // Load saved prefs
        etUrl.setText(prefs.getString(KEY_SERVER_URL, "https://automation.thebreadchapter.in"))
        etStation.setText(prefs.getString(KEY_STATION, "all"))
        etToken.setText(prefs.getString(KEY_BRIDGE_TOKEN, ""))
        etPineAppId.setText(prefs.getString(KEY_PINE_APP_ID, "f99c338e6c444900a36c1a3a6303872b"))
        etAutoLoginUser.setText(prefs.getString(KEY_AUTO_LOGIN_USER, ""))
        etAutoLoginPass.setText(prefs.getString(KEY_AUTO_LOGIN_PASS, ""))

        val savedKitchenMac = prefs.getString(KEY_KITCHEN_MAC, DEFAULT_KITCHEN_MAC) ?: DEFAULT_KITCHEN_MAC
        val savedBevMac     = prefs.getString(KEY_BEVERAGE_MAC, DEFAULT_BEVERAGE_MAC) ?: DEFAULT_BEVERAGE_MAC

        setSpinnerSelection(spKitchen, printerList, savedKitchenMac)
        setSpinnerSelection(spBev, printerList, savedBevMac)

        btnTestKitchen.setOnClickListener {
            val device = spKitchen.selectedItem as? PrinterDevice
            device?.let { testPrinter(it.mac, "Kitchen") }
        }

        btnTestBev.setOnClickListener {
            val device = spBev.selectedItem as? PrinterDevice
            device?.let { testPrinter(it.mac, "Beverage") }
        }

        btnSave.setOnClickListener {
            val url     = etUrl.text.toString().trimEnd('/')
            val station = etStation.text.toString().trim()
            val kitchen = spKitchen.selectedItem as? PrinterDevice
            val beverage = spBev.selectedItem as? PrinterDevice
            val token   = etToken.text.toString().trim()
            val pineAppId = etPineAppId.text.toString().trim()
            val autoUser  = etAutoLoginUser.text.toString().trim()
            val autoPass  = etAutoLoginPass.text.toString()

            if (url.isBlank() || token.isBlank()) {
                Toast.makeText(this, "URL and Token are required", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            prefs.edit {
                putString(KEY_SERVER_URL, url)
                putString(KEY_STATION, station)
                putString(KEY_KITCHEN_MAC, kitchen?.mac ?: "")
                putString(KEY_BEVERAGE_MAC, beverage?.mac ?: "")
                putString(KEY_BRIDGE_TOKEN, token)
                putString(KEY_PINE_APP_ID, pineAppId)
                putString(KEY_AUTO_LOGIN_USER, autoUser)
                putString(KEY_AUTO_LOGIN_PASS, autoPass)
            }

            // Re-initialise Pine SDK if the Application ID was just set.
            (application as? BreadChapterApp)?.tryInitPineSdk()

            stopService(Intent(this, PrintBridgeService::class.java))
            startService(Intent(this, PrintBridgeService::class.java))

            Toast.makeText(this, "Saved. Bridge restarted.", Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    @SuppressLint("MissingPermission")
    private fun getAvailablePrinters(): List<PrinterDevice> {
        val devices = mutableListOf<PrinterDevice>()
        
        // 1. Add known defaults at the top
        devices.add(PrinterDevice("Kitchen Default", DEFAULT_KITCHEN_MAC))
        devices.add(PrinterDevice("Beverage Default", DEFAULT_BEVERAGE_MAC))

        // 2. Add paired devices
        try {
            val bm = getSystemService(BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bm.adapter
            if (adapter != null && adapter.isEnabled) {
                adapter.bondedDevices?.forEach { device ->
                    val printer = PrinterDevice(device.name ?: "Unknown", device.address)
                    if (!devices.any { it.mac == printer.mac }) {
                        devices.add(printer)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("Settings", "Error getting paired devices: ${e.message}")
        }

        return devices
    }

    private fun setSpinnerSelection(spinner: Spinner, list: List<PrinterDevice>, mac: String) {
        val index = list.indexOfFirst { it.mac == mac }
        if (index >= 0) {
            spinner.setSelection(index)
        }
    }

    private fun testPrinter(mac: String, name: String) {
        if (mac.isEmpty()) {
            Toast.makeText(this, "No printer selected", Toast.LENGTH_SHORT).show()
            return
        }

        lifecycleScope.launch {
            AppLogManager.log("Testing $name printer ($mac)...")
            val success = withContext(Dispatchers.IO) {
                try {
                    performTestPrint(mac, name)
                    true
                } catch (e: Exception) {
                    val err = "Test failed: ${e.message}"
                    Log.e("Settings", err)
                    AppLogManager.log("✖ $err")
                    false
                }
            }
            if (success) {
                AppLogManager.log("✓ $name Printer: OK")
                Toast.makeText(this@SettingsActivity, "$name Printer: OK", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this@SettingsActivity, "$name Printer: Connection Failed", Toast.LENGTH_LONG).show()
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun performTestPrint(mac: String, name: String) {
        val bm = getSystemService(BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bm.adapter ?: throw IOException("BT not available")
        if (!adapter.isEnabled) throw IOException("BT disabled")

        val device = adapter.getRemoteDevice(mac)
        val payload = EscPosHelper.buildTestTicket(name)

        val socket = try {
            device.createRfcommSocketToServiceRecord(SPP_UUID)
        } catch (_: Exception) {
            device.javaClass.getMethod("createRfcommSocket", Int::class.java).invoke(device, 1)
                as android.bluetooth.BluetoothSocket
        }

        socket.connect()
        socket.use {
            it.outputStream.write(payload)
            it.outputStream.flush()
            Thread.sleep(500)
        }
    }
}
