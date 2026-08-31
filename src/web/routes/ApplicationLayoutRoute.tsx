import { useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  redirect,
  useLoaderData,
  useNavigate,
  useParams,
  useRouteLoaderData,
} from "react-router";
import { formatCompanyRegistrationIdentifier } from "../../domain/swedish-identifiers";
import { authClient } from "../../modules/auth/client";
import {
  type Company,
  errorMessage,
  getSession,
  getSetupStatus,
  listCompanies,
  type SessionData,
} from "../api/client";
import { AppShell, navLinkClass, PageBody, PageHeader } from "../layout";
import {
  Button,
  Callout,
  Dialog,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  Panel,
  Select,
} from "../ui";

export type ApplicationData = {
  session: SessionData;
  companies: Company[];
};

const ADD_COMPANY_VALUE = "__add_company__";

function selectCompany(value: string | null, navigate: (path: string) => void): void {
  if (!value) return;
  navigate(value === ADD_COMPANY_VALUE ? "/companies/new" : `/companies/${value}/register`);
}

function CompanyMasthead({
  companies,
  selectedCompanyId,
  navigate,
}: {
  companies: Company[];
  selectedCompanyId?: string;
  navigate: (path: string) => void;
}) {
  if (companies.length === 0) {
    return (
      <Link className="text-sm text-accent-ink underline underline-offset-2" to="/companies/new">
        Lägg till bolag
      </Link>
    );
  }

  const options = [
    ...companies.map((company) => ({
      value: company.id,
      label: company.legalName,
      description: formatCompanyRegistrationIdentifier(company),
    })),
    {
      value: ADD_COMPANY_VALUE,
      label: "Lägg till bolag",
      description: "Skapa ett nytt bolag",
    },
  ];

  return (
    <Select
      size="sm"
      options={options}
      value={selectedCompanyId ?? null}
      placeholder="Välj bolag"
      onValueChange={(value) => selectCompany(value, navigate)}
      className="w-56"
    />
  );
}

function AccountMenu({ userName, isAdmin }: { userName: string; isAdmin: boolean }) {
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [passkeyDialogOpen, setPasskeyDialogOpen] = useState(false);
  const [passkeyName, setPasskeyName] = useState("Min passkey");
  const [passkeyError, setPasskeyError] = useState<string>();
  const [passkeySaved, setPasskeySaved] = useState(false);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    navigate("/login", { replace: true });
  }

  function openPasskeyDialog() {
    setPasskeyError(undefined);
    setPasskeySaved(false);
    setPasskeyDialogOpen(true);
  }

  async function registerPasskey() {
    setRegisteringPasskey(true);
    setPasskeyError(undefined);
    try {
      const result = await authClient.passkey.addPasskey({ name: passkeyName.trim() });
      if (result?.error) {
        setPasskeyError(result.error.message ?? "Passkey kunde inte registreras.");
        return;
      }
      setPasskeySaved(true);
    } catch (error) {
      setPasskeyError(errorMessage(error));
    } finally {
      setRegisteringPasskey(false);
    }
  }

  return (
    <>
      <Menu
        trigger={
          <Button size="sm" variant="ghost" loading={signingOut}>
            {userName}
          </Button>
        }
      >
        <MenuItem onClick={openPasskeyDialog}>Registrera passkey…</MenuItem>
        <MenuItem onClick={() => navigate("/account/api-keys")}>API-nycklar</MenuItem>
        {isAdmin ? (
          <MenuItem onClick={() => navigate("/admin/users")}>Användare och inbjudningar</MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem onClick={signOut}>Logga ut</MenuItem>
      </Menu>
      <Dialog
        open={passkeyDialogOpen}
        onOpenChange={setPasskeyDialogOpen}
        title="Registrera passkey"
        description="Lägg till den här enheten eller säkerhetsnyckeln som inloggningsmetod."
        size="sm"
        footer={
          passkeySaved ? (
            <Button variant="primary" onClick={() => setPasskeyDialogOpen(false)}>
              Stäng
            </Button>
          ) : (
            <>
              <Button onClick={() => setPasskeyDialogOpen(false)} disabled={registeringPasskey}>
                Avbryt
              </Button>
              <Button
                variant="primary"
                onClick={registerPasskey}
                loading={registeringPasskey}
                disabled={!passkeyName.trim()}
              >
                Registrera passkey
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {passkeySaved ? (
            <Callout tone="positive" title="Passkey registrerad">
              Du kan nu använda den för att logga in.
            </Callout>
          ) : (
            <>
              {passkeyError ? <Callout tone="critical">{passkeyError}</Callout> : null}
              <Field label="Namn på passkey" required>
                <Input
                  value={passkeyName}
                  onChange={(event) => setPasskeyName(event.target.value)}
                  required
                  autoFocus
                />
              </Field>
              <p className="text-sm text-ink-muted">
                Din webbläsare eller säkerhetsnyckel kommer att be dig bekräfta registreringen.
              </p>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}

export async function applicationLoader(): Promise<ApplicationData | Response> {
  try {
    if ((await getSetupStatus()).required) return redirect("/setup");
    const [session, companies] = await Promise.all([getSession(), listCompanies()]);
    return { session, companies };
  } catch (error) {
    if (error instanceof Error) {
      if ("status" in error) {
        if (error.status === 401) return redirect("/login");
      }
    }
    throw error;
  }
}

export function useApplicationData(): ApplicationData {
  const data = useRouteLoaderData("application") as ApplicationData | undefined;
  if (!data) throw new Error("Application data is unavailable");
  return data;
}

export function ApplicationLayoutRoute() {
  const data = useLoaderData() as ApplicationData;
  const { companyId } = useParams();
  const navigate = useNavigate();
  const selectedCompany = data.companies.find((company) => company.id === companyId);
  const isAdmin = data.session.user.role?.split(",").includes("admin") ?? false;

  return (
    <AppShell
      masthead={
        <CompanyMasthead
          companies={data.companies}
          selectedCompanyId={selectedCompany?.id}
          navigate={navigate}
        />
      }
      account={<AccountMenu userName={data.session.user.name} isAdmin={isAdmin} />}
      nav={
        selectedCompany ? (
          <>
            <PrimaryNavLink to={`/companies/${selectedCompany.id}/register`}>
              Aktiebok
            </PrimaryNavLink>
            <PrimaryNavLink to={`/companies/${selectedCompany.id}/events`}>
              Händelser
            </PrimaryNavLink>
            <PrimaryNavLink to={`/companies/${selectedCompany.id}/shareholders`}>
              Aktieägare
            </PrimaryNavLink>
            <PrimaryNavLink to={`/companies/${selectedCompany.id}/share-classes`}>
              Aktieslag
            </PrimaryNavLink>
            {isAdmin ? (
              <PrimaryNavLink to={`/companies/${selectedCompany.id}/settings`}>
                Inställningar
              </PrimaryNavLink>
            ) : null}
          </>
        ) : undefined
      }
    >
      <Outlet />
    </AppShell>
  );
}

function PrimaryNavLink({ to, children }: { to: string; children: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => navLinkClass(isActive)}>
      {children}
    </NavLink>
  );
}

export function ApplicationIndexRoute() {
  const { companies } = useApplicationData();
  return companies[0] ? (
    <Navigate to={`/companies/${companies[0].id}/register`} replace />
  ) : (
    <Navigate to="/companies" replace />
  );
}

export function RouteError() {
  return (
    <>
      <PageHeader title="Något gick fel" />
      <PageBody width="prose">
        <Callout tone="critical" title="Sidan kunde inte läsas in">
          Försök igen. Om felet kvarstår, kontrollera serverloggen.
        </Callout>
      </PageBody>
    </>
  );
}

export function NotFoundRoute() {
  return (
    <>
      <PageHeader title="Sidan finns inte" />
      <PageBody width="prose">
        <Panel>
          <p className="text-sm text-ink-muted">Den begärda sidan kunde inte hittas.</p>
        </Panel>
      </PageBody>
    </>
  );
}
