import type { ApiKey } from "@better-auth/api-key/types";
import { type FormEvent, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { authClient } from "../../modules/auth/client";
import { GLOBAL_ROLES, type InvitableRole } from "../../modules/auth/roles";
import {
  type AdminDirectory,
  createAdminInvitation,
  errorMessage,
  getAdminDirectory,
  removeAdminUser,
} from "../api/client";
import { PageBody, PageHeader, PageSection } from "../layout";
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  EmptyState,
  Field,
  FormActions,
  formatTimestamp,
  Input,
  Panel,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Textarea,
} from "../ui";
import { useApplicationAccess } from "./ApplicationLayoutRoute";

type ApiKeySummary = Pick<
  ApiKey,
  "id" | "name" | "start" | "enabled" | "createdAt" | "expiresAt" | "lastRequest"
>;

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

const INVITATION_DURATION_OPTIONS = [
  { value: "15", label: "15 minuter" },
  { value: "60", label: "1 timme" },
  { value: "480", label: "8 timmar" },
  { value: "1440", label: "24 timmar" },
] as const;
const INVITATION_ROLE_OPTIONS = [
  { value: GLOBAL_ROLES.user, label: "Kan läsa och ändra" },
  { value: GLOBAL_ROLES.readonly, label: "Endast läsning" },
] as const;

type InvitationDuration = (typeof INVITATION_DURATION_OPTIONS)[number]["value"];

function rolesLabel(roles: readonly string[]): string {
  return roles
    .map((role) => {
      if (role === GLOBAL_ROLES.admin) return "Administratör";
      if (role === GLOBAL_ROLES.user) return "Användare";
      if (role === GLOBAL_ROLES.readonly) return "Endast läsning";
      return role;
    })
    .join(", ");
}

function invitationBadge(status: AdminDirectory["invitations"][number]["status"]) {
  if (status === "PENDING") return <Badge tone="caution">Väntar</Badge>;
  if (status === "CONSUMED") return <Badge tone="positive">Accepterad</Badge>;
  if (status === "REVOKED") return <Badge>Ersatt</Badge>;
  return <Badge tone="critical">Utgången</Badge>;
}

export function adminDirectoryLoader(): Promise<AdminDirectory> {
  return getAdminDirectory();
}

function InvitationForm() {
  const revalidator = useRevalidator();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>(GLOBAL_ROLES.user);
  const [duration, setDuration] = useState<InvitationDuration>("15");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [acceptanceUrl, setAcceptanceUrl] = useState<string>();

  async function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setAcceptanceUrl(undefined);
    try {
      const durationMinutes = Number(duration);
      const created = await createAdminInvitation({
        name,
        email,
        role,
        expiresAt:
          duration === "15"
            ? undefined
            : new Date(Date.now() + durationMinutes * 60 * 1000).toISOString(),
      });
      setAcceptanceUrl(created.acceptanceUrl);
      setName("");
      setEmail("");
      await revalidator.revalidate();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel>
      <form className="flex max-w-form flex-col gap-4" onSubmit={submitInvitation}>
        {error ? <Callout tone="critical">{error}</Callout> : null}
        {acceptanceUrl ? (
          <Callout tone="positive" title="Inbjudan skapad">
            <div className="flex flex-col gap-2">
              <p>Skicka länken till användaren innan den går ut.</p>
              <Textarea className="font-mono text-xs" rows={3} value={acceptanceUrl} readOnly />
              <div>
                <Button size="sm" onClick={() => navigator.clipboard.writeText(acceptanceUrl)}>
                  Kopiera länk
                </Button>
              </div>
            </div>
          </Callout>
        ) : null}
        <Field label="Namn" required>
          <Input value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field label="E-post" required>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label="Behörighet" required>
          <Select
            options={INVITATION_ROLE_OPTIONS}
            value={role}
            onValueChange={(value) => {
              if (value === GLOBAL_ROLES.user || value === GLOBAL_ROLES.readonly) setRole(value);
            }}
            required
          />
        </Field>
        <Field label="Giltighetstid" required>
          <Select
            options={INVITATION_DURATION_OPTIONS}
            value={duration}
            onValueChange={(value) => {
              if (value) setDuration(value);
            }}
            required
          />
        </Field>
        <FormActions>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={!name.trim() || !email.trim()}
          >
            Skapa inbjudan
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}

function UsersTable({ users }: { users: AdminDirectory["users"] }) {
  const revalidator = useRevalidator();
  const [removing, setRemoving] = useState<AdminDirectory["users"][number]>();
  const [removePending, setRemovePending] = useState(false);
  const [error, setError] = useState<string>();

  async function removeUser() {
    if (!removing) return;
    setRemovePending(true);
    setError(undefined);
    try {
      await removeAdminUser(removing.id);
      setRemoving(undefined);
      await revalidator.revalidate();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRemovePending(false);
    }
  }

  return (
    <>
      {error ? <Callout tone="critical">{error}</Callout> : null}
      <Table caption="Användare i Stam" captionHidden>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Namn</TableHeaderCell>
            <TableHeaderCell>E-post</TableHeaderCell>
            <TableHeaderCell>Roll</TableHeaderCell>
            <TableHeaderCell>Åtkomst</TableHeaderCell>
            <TableHeaderCell>Skapad</TableHeaderCell>
            <TableHeaderCell>Åtgärd</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {users.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell header>{entry.name}</TableCell>
              <TableCell>{entry.email}</TableCell>
              <TableCell>{rolesLabel(entry.roles)}</TableCell>
              <TableCell>
                <Badge tone={entry.accessStatus === "ACTIVE" ? "positive" : "critical"}>
                  {entry.accessStatus === "ACTIVE" ? "Tillåten" : "Spärrad"}
                </Badge>
              </TableCell>
              <TableCell>{formatTimestamp(entry.createdAt)}</TableCell>
              <TableCell>
                {entry.removable ? (
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(entry)}>
                    Ta bort
                  </Button>
                ) : (
                  "Ditt konto"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
        title="Ta bort användare"
        description={`${removing?.name ?? "Användaren"} tas bort permanent. Alla sessioner, lösenord, passkeys och API-nycklar slutar fungera omedelbart.`}
        confirmLabel="Ta bort användare"
        tone="danger"
        loading={removePending}
        onConfirm={removeUser}
      />
    </>
  );
}

function InvitationsTable({ invitations }: { invitations: AdminDirectory["invitations"] }) {
  if (invitations.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="Inga inbjudningar"
          description="Skapa en inbjudan för att registrera en ny användare."
        />
      </Panel>
    );
  }
  return (
    <Table caption="Inbjudningar i Stam" captionHidden>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Namn</TableHeaderCell>
          <TableHeaderCell>E-post</TableHeaderCell>
          <TableHeaderCell>Roll</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Skapad</TableHeaderCell>
          <TableHeaderCell>Går ut</TableHeaderCell>
          <TableHeaderCell>Skapad av</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {invitations.map((invitation) => (
          <TableRow key={invitation.id}>
            <TableCell header>{invitation.name}</TableCell>
            <TableCell>{invitation.email}</TableCell>
            <TableCell>{rolesLabel(invitation.roles)}</TableCell>
            <TableCell>{invitationBadge(invitation.status)}</TableCell>
            <TableCell>{formatTimestamp(invitation.createdAt)}</TableCell>
            <TableCell>{formatTimestamp(invitation.expiresAt)}</TableCell>
            <TableCell>{invitation.createdByName}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function AdminDirectoryRoute() {
  const directory = useLoaderData() as AdminDirectory;
  return (
    <>
      <PageHeader
        title="Användare och inbjudningar"
        meta={`${directory.users.length} användare · ${directory.invitations.length} inbjudningar`}
      />
      <PageBody>
        <PageSection
          title="Bjud in användare"
          description="Inbjudningslänken visas bara när den skapas. Välj hur länge den ska gälla."
        >
          <InvitationForm />
        </PageSection>
        <PageSection title="Användare">
          <UsersTable users={directory.users} />
        </PageSection>
        <PageSection title="Inbjudningar">
          <InvitationsTable invitations={directory.invitations} />
        </PageSection>
      </PageBody>
    </>
  );
}

function toApiKeySummary(key: ApiKey): ApiKeySummary {
  return {
    id: key.id,
    name: key.name,
    start: key.start,
    enabled: key.enabled,
    createdAt: key.createdAt,
    expiresAt: key.expiresAt,
    lastRequest: key.lastRequest,
  };
}

export async function apiKeysLoader(): Promise<ApiKeySummary[]> {
  const result = await authClient.apiKey.list({ query: { limit: 100 } });
  if (result.error) throw new Error(result.error.message ?? "API-nycklar kunde inte hämtas.");
  return (result.data?.apiKeys ?? []).map((key) => toApiKeySummary(key as ApiKey));
}

export function ApiKeysRoute() {
  const loadedKeys = useLoaderData() as ApiKeySummary[];
  const { isReadOnly } = useApplicationAccess();
  const [keys, setKeys] = useState(loadedKeys);
  const [name, setName] = useState("");
  const [revealedKey, setRevealedKey] = useState<string>();
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeySummary>();
  const [revokePending, setRevokePending] = useState(false);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(undefined);
    setRevealedKey(undefined);
    try {
      const result = await authClient.apiKey.create({ name, expiresIn: ONE_YEAR_SECONDS });
      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? "API-nyckeln kunde inte skapas.");
      }
      setRevealedKey(result.data.key);
      setKeys((current) => [toApiKeySummary(result.data as ApiKey), ...current]);
      setName("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey() {
    if (!revoking) return;
    setRevokePending(true);
    setError(undefined);
    try {
      const result = await authClient.apiKey.delete({ keyId: revoking.id });
      if (result.error)
        throw new Error(result.error.message ?? "API-nyckeln kunde inte återkallas.");
      setKeys((current) => current.filter((key) => key.id !== revoking.id));
      setRevoking(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRevokePending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="API-nycklar"
        meta={
          isReadOnly
            ? "Maskinåtkomst med samma läsbehörighet som ditt konto"
            : "Maskinåtkomst med samma behörighet som ditt konto"
        }
      />
      <PageBody>
        <PageSection
          title="Skapa API-nyckel"
          description="Nyckeln gäller i ett år och visas bara en gång."
        >
          <Panel>
            <form className="flex max-w-form flex-col gap-4" onSubmit={createKey}>
              {error ? <Callout tone="critical">{error}</Callout> : null}
              {revealedKey ? (
                <Callout tone="caution" title="Kopiera nyckeln nu">
                  <div className="flex flex-col gap-2">
                    <p>Den fullständiga nyckeln kan inte visas igen.</p>
                    <Textarea className="font-mono text-xs" rows={3} value={revealedKey} readOnly />
                    <div>
                      <Button size="sm" onClick={() => navigator.clipboard.writeText(revealedKey)}>
                        Kopiera nyckel
                      </Button>
                    </div>
                  </div>
                </Callout>
              ) : null}
              <Field
                label="Namn"
                description="Beskriv agenten eller integrationen som ska använda nyckeln."
                required
              >
                <Input value={name} onChange={(event) => setName(event.target.value)} required />
              </Field>
              <FormActions>
                <Button type="submit" variant="primary" loading={creating} disabled={!name.trim()}>
                  Skapa API-nyckel
                </Button>
              </FormActions>
            </form>
          </Panel>
        </PageSection>

        <PageSection
          title="Agentåtkomst"
          description="Skicka nyckeln i x-api-key. GET /api/agent beskriver tillgängliga operationer för nyckelns användare och roll."
        >
          <Panel>
            <code className="font-mono text-sm">GET /api/agent</code>
          </Panel>
        </PageSection>

        <PageSection title="Dina API-nycklar">
          {keys.length === 0 ? (
            <Panel>
              <EmptyState
                title="Inga API-nycklar"
                description="Skapa en nyckel för en agent eller integration."
              />
            </Panel>
          ) : (
            <Table caption="API-nycklar" captionHidden>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Namn</TableHeaderCell>
                  <TableHeaderCell>Börjar med</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Skapad</TableHeaderCell>
                  <TableHeaderCell>Går ut</TableHeaderCell>
                  <TableHeaderCell>Senast använd</TableHeaderCell>
                  <TableHeaderCell>Åtgärd</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell header>{key.name ?? "Namnlös nyckel"}</TableCell>
                    <TableCell mono>{key.start ? `${key.start}…` : "Saknas"}</TableCell>
                    <TableCell>
                      <Badge tone={key.enabled ? "positive" : "critical"}>
                        {key.enabled ? "Aktiv" : "Inaktiv"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatTimestamp(key.createdAt.toISOString())}</TableCell>
                    <TableCell>
                      {key.expiresAt
                        ? formatTimestamp(key.expiresAt.toISOString())
                        : "Utan slutdatum"}
                    </TableCell>
                    <TableCell>
                      {key.lastRequest
                        ? formatTimestamp(key.lastRequest.toISOString())
                        : "Aldrig använd"}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setRevoking(key)}>
                        Återkalla
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PageSection>
      </PageBody>

      <ConfirmDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => {
          if (!open) setRevoking(undefined);
        }}
        title="Återkalla API-nyckel"
        description={`Nyckeln ${revoking?.name ?? ""} slutar fungera omedelbart.`}
        confirmLabel="Återkalla nyckel"
        tone="danger"
        loading={revokePending}
        onConfirm={revokeKey}
      />
    </>
  );
}
