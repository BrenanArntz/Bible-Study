(() => {
  const SUPABASE_URL = "https://msalkoijfkzqbtvulybp.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_m9FpMqwgtPWlN2lFZ2WrmQ_bNOdgG7P";
  const SESSION_KEY = "sb-msalkoijfkzqbtvulybp-auth-token";

  window.addEventListener("DOMContentLoaded", () => {
    const form = document.querySelector("#auth-form");
    const emailField = document.querySelector("#auth-email");
    const passwordField = document.querySelector("#auth-password");
    const message = document.querySelector("#auth-message");
    const button = document.querySelector("#auth-submit-button");
    if (!form || !emailField || !passwordField || !message || !button) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const email = emailField.value.trim();
      const password = passwordField.value;
      message.textContent = "Signing in…";
      button.disabled = true;
      try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error_description || payload.msg || "Sign-in failed.");
        payload.expires_at ||= Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600);
        if (window.supabase?.createClient) {
          const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
          const { error } = await client.auth.setSession({
            access_token: payload.access_token,
            refresh_token: payload.refresh_token,
          });
          if (error) throw error;
        }
        localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
        passwordField.value = "";
        message.textContent = "Signed in. Opening your study…";
        window.location.replace("./index.html");
      } catch (error) {
        message.textContent = error.message || "Could not sign in. Check your connection and try again.";
        button.disabled = false;
      }
    }, true);
  });
})();
