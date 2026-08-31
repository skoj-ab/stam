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
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  if (!token) return <Navigate to="/login" replace />;

  async function accept() {
    setLoading(true);
    setError(undefined);
    const result = await authClient.passkey.addPasskey({
      name,
      context: token,
      createSession: true,
    });
    setLoading(false);
    if (result?.error) {
      setError(result.error.message ?? "Inbjudan kunde inte användas.");
      return;
    }
    navigate("/", { replace: true });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-form">
        <PageHeader title="Acceptera inbjudan" meta="Registrera en passkey för ditt konto" />
        <PageBody width="form">
          {error ? <Callout tone="critical">{error}</Callout> : null}
          <Panel>
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
                  onClick={accept}
                  loading={loading}
                  disabled={!name.trim()}
                >
                  Registrera passkey
                </Button>
              </FormActions>
            </div>
          </Panel>
        </PageBody>
      </div>
    </AppShell>
  );
}
