package com.examinerapp

import android.content.Context
import java.net.InetAddress
import java.net.Socket
import java.security.KeyStore
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import okhttp3.ConnectionPool

/**
 * The TLS setup of fetch(): the phone's client certificate (PhoneKeyManager)
 * and the platform's trust manager, i.e. network_security_config.xml.
 *
 * When the certificate changes (re-enrollment, e.g. for another teacher),
 * reset() drops the open connections and the TLS sessions: both would keep
 * presenting the old certificate to the phone port, where a resumed session
 * carries the certificate of the handshake it came from.
 */
object PhoneTls {
    val trustManager: X509TrustManager by lazy {
        TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            .apply { init(null as KeyStore?) }
            .trustManagers
            .filterIsInstance<X509TrustManager>()
            .first()
    }

    val connectionPool = ConnectionPool()

    private lateinit var appContext: Context

    @Volatile
    private var sslContext: SSLContext? = null

    fun init(context: Context) {
        appContext = context.applicationContext
        sslContext = newSslContext()
    }

    fun reset() {
        sslContext = newSslContext()
        connectionPool.evictAll()
    }

    private fun newSslContext(): SSLContext =
        SSLContext.getInstance("TLS").apply {
            init(arrayOf(PhoneKeyManager(appContext)), arrayOf(trustManager), null)
        }

    private fun current(): SSLSocketFactory = sslContext!!.socketFactory

    /** Always uses the current SSLContext, so a reset() reaches the existing OkHttp client. */
    val socketFactory: SSLSocketFactory = object : SSLSocketFactory() {
        override fun getDefaultCipherSuites(): Array<String> = current().defaultCipherSuites
        override fun getSupportedCipherSuites(): Array<String> = current().supportedCipherSuites
        override fun createSocket(s: Socket?, host: String?, port: Int, autoClose: Boolean): Socket =
            current().createSocket(s, host, port, autoClose)
        override fun createSocket(): Socket = current().createSocket()
        override fun createSocket(host: String?, port: Int): Socket = current().createSocket(host, port)
        override fun createSocket(host: String?, port: Int, localHost: InetAddress?, localPort: Int): Socket =
            current().createSocket(host, port, localHost, localPort)
        override fun createSocket(host: InetAddress?, port: Int): Socket = current().createSocket(host, port)
        override fun createSocket(address: InetAddress?, port: Int, localAddress: InetAddress?, localPort: Int): Socket =
            current().createSocket(address, port, localAddress, localPort)
    }
}
