package com.examinerapp

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.modules.network.OkHttpClientProvider
import java.security.KeyStore
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(NfcHcePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    useClientCertificateForFetch()
    loadReactNative(this)
  }

  /**
   * fetch() goes through React Native's OkHttp client; give it this phone's
   * client certificate (PhoneKeyManager), presented only when a server asks
   * for one — the PIE API's phone port. Server certificates are still checked
   * by the platform's trust manager, i.e. by network_security_config.xml.
   */
  private fun useClientCertificateForFetch() {
    val trustManagers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
      .apply { init(null as KeyStore?) }
      .trustManagers
    val trustManager = trustManagers.filterIsInstance<X509TrustManager>().first()
    val sslContext = SSLContext.getInstance("TLS").apply {
      init(arrayOf(PhoneKeyManager(applicationContext)), trustManagers, null)
    }
    OkHttpClientProvider.setOkHttpClientFactory {
      OkHttpClientProvider.createClientBuilder(applicationContext)
        .sslSocketFactory(sslContext.socketFactory, trustManager)
        .build()
    }
  }
}
