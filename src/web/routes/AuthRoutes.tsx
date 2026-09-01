import { type FormEvent, useState } from "react";
import { Navigate, redirect, useNavigate, useSearchParams } from "react-router";
import { authClient } from "../../modules/auth/client";
import { ApiError, createInitialAdmin, errorMessage, getSetupStatus } from "../api/client";
import { AppShell, PageBody, PageHeader } from "../layout";
import { Button, Callout, Field, FormActions, Input, Panel } from "../ui";

export async function loginLoader() {
  if ((await getSetupStatus()).required) return redirect("/setup");
  return null;
}

export async function setupLoader() {
  if (!(await getSetupStatus()).required) return redirect("/login");
  return null;
}

export function SetupRoute() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const name = String(form.get("name") ?? "");
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("passwordConfirmation") ?? "")) {
      setError("Lösenorden stämmer inte överens.");
      setLoading(false);
      return;
    }

    try {
      const created = await createInitialAdmin({ email, name, password });
      const signedIn = await authClient.signIn.email({
        email: created.user.email,
        password,
        rememberMe: true,
      });
      if (signedIn.error) throw new Error(signedIn.error.message ?? "Inloggningen misslyckades.");
      navigate("/", { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        navigate("/login", { replace: true });
        return;
      }
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-form">
        <PageHeader title="Konfigurera Stam" meta="Skapa installationens första administratör" />
        <PageBody width="form">
          <Callout tone="caution" title="Första besökaren blir administratör">
            Slutför konfigurationen innan installationen lämnas tillgänglig för andra.
          </Callout>
          {error ? <Callout tone="critical">{error}</Callout> : null}
          <Panel title="Administratör">
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <Field label="Namn" required>
                <Input name="name" autoComplete="name" required autoFocus />
              </Field>
              <Field label="E-postadress" required>
                <Input name="email" type="email" autoComplete="username" required />
              </Field>
              <Field label="Lösenord" description="Minst 8 och högst 128 tecken." required>
                <Input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </Field>
              <Field label="Bekräfta lösenord" required>
                <Input
                  name="passwordConfirmation"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </Field>
              <FormActions align="start">
                <Button type="submit" variant="primary" loading={loading}>
                  Skapa administratör
                </Button>
              </FormActions>
            </form>
          </Panel>
        </PageBody>
      </div>
    </AppShell>
  );
}

export function LoginRoute() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      rememberMe: true,
    });
    setLoading(false);
    if (result.error) {
      setError(result.error.message ?? "Inloggningen misslyckades.");
      return;
    }
    navigate("/", { replace: true });
  }

  async function signInWithPasskey() {
    setLoading(true);
    setError(undefined);
    const result = await authClient.signIn.passkey();
    setLoading(false);
    if (result?.error) {
      setError(result.error.message ?? "Inloggningen med passkey misslyckades.");
      return;
    }
    navigate("/", { replace: true });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-form">
        <PageHeader title="Logga in" meta="Lokal åtkomst till Stam" />
        <PageBody width="form">
          {error ? <Callout tone="critical">{error}</Callout> : null}
          <Panel title="E-post och lösenord">
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <Field label="E-postadress" required>
                <Input name="email" type="email" autoComplete="username" required />
              </Field>
              <Field label="Lösenord" required>
                <Input name="password" type="password" autoComplete="current-password" required />
              </Field>
              <FormActions align="start">
                <Button type="submit" variant="primary" loading={loading}>
                  Logga in
                </Button>
                <Button type="button" onClick={signInWithPasskey} disabled={loading}>
                  Logga in med passkey
                </Button>
              </FormActions>
            </form>
          </Panel>
        </PageBody>
      </div>
    </AppShell>
  );
}

export function AcceptInvitationRoute() {
  const [query] = useSearchParams();
  const navigate = useNavigate();
  const token = query.get("token");
  const [name, setName] = useState("Min passkey");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState<"passkey" | "password">();

  if (!token) return <Navigate to="/login" replace />;
  const invitationToken = token;

  function invitationError(code: string | undefined): string {
    if (code === "EXPIRED_INVITATION") return "Inbjudan har gått ut.";
    if (code === "CONSUMED_INVITATION") return "Inbjudan har redan använts.";
    if (code === "REVOKED_INVITATION") return "Inbjudan har ersatts av en nyare länk.";
    if (code === "CREDENTIAL_ACCOUNT_EXISTS") {
      return "Kontot har redan ett lösenord. Logga in med det befintliga lösenordet.";
    }
    if (code === "PASSWORD_TOO_SHORT") return "Lösenordet måste innehålla minst 8 tecken.";
    if (code === "PASSWORD_TOO_LONG") return "Lösenordet får innehålla högst 128 tecken.";
    return "Inbjudan kunde inte användas.";
  }

  async function acceptWithPasskey() {
    setLoading("passkey");
    setError(undefined);
    const result = await authClient.passkey.addPasskey({
      name,
      context: invitationToken,
      createSession: true,
    });
    setLoading(undefined);
    if (result?.error) {
      setError(invitationError("code" in result.error ? result.error.code : undefined));
      return;
    }
    navigate("/", { replace: true });
  }

  async function acceptWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (password !== passwordConfirmation) {
      setError("Lösenorden stämmer inte överens.");
      return;
    }

    setLoading("password");
    const result = await authClient.invitation.acceptPassword({
      token: invitationToken,
      newPassword: password,
    });
    setLoading(undefined);
    if (result.error) {
      setError(invitationError(result.error.code));
      return;
    }
    navigate("/", { replace: true });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-form">
        <PageHeader title="Acceptera inbjudan" meta="Välj hur du vill logga in" />
        <PageBody width="form">
          {error ? <Callout tone="critical">{error}</Callout> : null}
          <Panel title="Passkey · rekommenderas">
            <div className="flex flex-col gap-4">
              <Field label="Namn på passkey" required>
                <Input value={name} onChange={(event) => setName(event.target.value)} required />
              </Field>
              <p className="text-sm text-ink-muted">
                Din webbläsare eller säkerhetsnyckel kommer att be dig bekräfta registreringen.
              </p>
              <FormActions align="start">
                <Button
                  variant="primary"
                  onClick={acceptWithPasskey}
                  loading={loading === "passkey"}
                  disabled={!name.trim() || Boolean(loading)}
                >
                  Registrera passkey
                </Button>
              </FormActions>
            </div>
          </Panel>
          <Panel title="Lösenord">
            <form className="flex flex-col gap-4" onSubmit={acceptWithPassword}>
              <p className="text-sm text-ink-muted">
                Använd lösenord om du inte kan skapa en passkey på den här enheten.
              </p>
              <Field label="Lösenord" description="Minst 8 och högst 128 tecken." required>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  maxLength={128}
                  required
                />
              </Field>
              <Field label="Bekräfta lösenord" required>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  minLength={8}
                  maxLength={128}
                  required
                />
              </Field>
              <FormActions align="start">
                <Button type="submit" loading={loading === "password"} disabled={Boolean(loading)}>
                  Fortsätt med lösenord
                </Button>
              </FormActions>
            </form>
          </Panel>
        </PageBody>
      </div>
    </AppShell>
  );
}
