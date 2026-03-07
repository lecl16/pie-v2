import { getTranslations } from "next-intl/server";

import LoginForm from "@/components/loginForm";

export default async function LoginPage() {
  const t = await getTranslations();
  
  return (
    <>
      {/* Full-screen background div with absolute positioning */}
      <div 
        className="fixed inset-0 z-0" 
        style={{
          backgroundImage: "url('/background.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          width: "100vw",
          height: "100vh"
        }}
      />
      
      {/* Content container */}
      <div className="relative z-10 min-h-screen w-full flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md">
          <h1 className="text-4xl font-bold mb-8 text-center">{t("Login")}</h1>
          <LoginForm />
        </div>
      </div>
    </>
  );
}