import { type FormEvent, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { authClient } from "../../modules/auth/client";
import { AppShell, PageBody, PageHeader } from "../layout";
import { Button, Callout, Field, FormActions, Input, Panel } from "../ui";

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
