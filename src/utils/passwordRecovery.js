export const PASSWORD_RECOVERY_KEY = "inkflow_password_recovery";

export function getResetPasswordRedirectUrl() {
  return `${window.location.origin}/reset-password`;
}

export function markPasswordRecovery() {
  sessionStorage.setItem(PASSWORD_RECOVERY_KEY, "1");
}

export function clearPasswordRecovery() {
  sessionStorage.removeItem(PASSWORD_RECOVERY_KEY);
}

export function isRecoveryMarked() {
  return sessionStorage.getItem(PASSWORD_RECOVERY_KEY) === "1";
}

export function getRecoveryUrlState() {
  const hash = window.location.hash;
  const hashParams = new URLSearchParams(hash.slice(1));
  const searchParams = new URLSearchParams(window.location.search);

  const hasHashRecovery =
    hashParams.get("type") === "recovery" ||
    hash.includes("type=recovery") ||
    hash.includes("type%3Drecovery");

  const tokenHash = searchParams.get("token_hash");
  const queryType = searchParams.get("type");
  const hasQueryRecovery = queryType === "recovery" && Boolean(tokenHash);

  return {
    hasHashRecovery,
    hasQueryRecovery,
    tokenHash,
    hasPendingRecovery: hasHashRecovery || hasQueryRecovery
  };
}

/**
 * Magic links sometimes land on Site URL (/) instead of /reset-password.
 * Full-page navigation preserves the hash so Supabase can parse the recovery token.
 */
export function redirectRecoveryHashToResetPage() {
  const { hasHashRecovery } = getRecoveryUrlState();
  if (!hasHashRecovery || window.location.pathname === "/reset-password") {
    return false;
  }

  markPasswordRecovery();
  window.location.replace(`/reset-password${window.location.hash}`);
  return true;
}

export async function bootstrapRecoverySession(supabase) {
  const state = getRecoveryUrlState();

  if (state.hasQueryRecovery && state.tokenHash) {
    markPasswordRecovery();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: state.tokenHash,
      type: "recovery"
    });
    if (error) {
      throw error;
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("token_hash");
    url.searchParams.delete("type");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    return true;
  }

  if (!state.hasHashRecovery && !isRecoveryMarked()) {
    return false;
  }

  if (state.hasHashRecovery) {
    markPasswordRecovery();
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (success) => {
      if (settled) {
        return;
      }
      settled = true;
      subscription.unsubscribe();
      clearTimeout(timeoutId);
      resolve(success);
    };

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && isRecoveryMarked())) {
        finish(true);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && isRecoveryMarked()) {
        finish(true);
      }
    });

    const timeoutId = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      finish(Boolean(session));
    }, 3000);
  });
}
