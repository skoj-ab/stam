import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams, useRevalidator } from "react-router";
import { formatCompanyRegistrationIdentifier } from "../../domain/swedish-identifiers";
import { type Company, errorMessage, removeCompany, requestJson } from "../api/client";
import { PageBody, PageHeader, PageSection } from "../layout";
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  EmptyState,
  Field,
  FormActions,
  Input,
  linkButtonClass,
  Panel,
  PlusIcon,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui";
import { useApplicationAccess, useApplicationData } from "./ApplicationLayoutRoute";

export function CompaniesRoute() {
  const { companies } = useApplicationData();
  const { canWrite } = useApplicationAccess();
  return (
    <>
      <PageHeader
        title="Bolag"
        meta={`${companies.length} registrerade bolag`}
        actions={
          canWrite ? (
            <Link className={linkButtonClass("primary")} to="/companies/new">
              <PlusIcon /> Lägg till bolag
            </Link>
          ) : undefined
        }
      />
      <PageBody>
        <PageSection title="Bolagsregister">
          {companies.length === 0 ? (
            <EmptyState
              title="Inga bolag ännu"
              description={
                canWrite
                  ? "Lägg till det första bolaget för att börja bygga aktieboken."
                  : "Det finns inget bolag att visa."
              }
              action={
                canWrite ? (
                  <Link className={linkButtonClass("primary")} to="/companies/new">
                    Lägg till bolag
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <Table caption="Registrerade bolag" captionHidden>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Bolag</TableHeaderCell>
                  <TableHeaderCell>Registreringsnummer</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {companies.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell header>
                      <Link
                        className="text-accent-ink underline underline-offset-2"
                        to={`/companies/${company.id}/register`}
                      >
                        {company.legalName}
                      </Link>
                    </TableCell>
                    <TableCell mono>{formatCompanyRegistrationIdentifier(company)}</TableCell>
                    <TableCell>
                      <Badge tone={company.status === "ACTIVE" ? "positive" : "caution"}>
                        {company.status === "ACTIVE" ? "Aktivt" : "Utkast"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PageSection>
      </PageBody>
    </>
  );
}

export function CreateCompanyRoute() {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const company = await requestJson<Company>({
        path: "/api/companies",
        init: {
          method: "POST",
          body: JSON.stringify({
            legalName: String(form.get("legalName") ?? ""),
            registrationCountry: "SE",
            registrationScheme: "ORGANISATIONSNUMMER",
            registrationValue: String(form.get("registrationValue") ?? ""),
            initialShareClass: {
              name: "A",
              votesPerShare: "1",
              effectiveFrom: new Date().toISOString().slice(0, 10),
            },
          }),
        },
      });
      revalidator.revalidate();
      navigate(`/companies/${company.id}/shareholders`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Lägg till bolag"
        meta="Bolaget skapas som utkast med aktieslag A"
        actions={
          <>
            <Link className={linkButtonClass("secondary")} to="/companies/new/fortnox">
              Importera från Fortnox
            </Link>
            <Link className={linkButtonClass("secondary")} to="/companies/new/ocf">
              Importera OCF
            </Link>
          </>
        }
      />
      <PageBody width="form">
        {error ? <Callout tone="critical">{error}</Callout> : null}
        <Panel title="Bolagsuppgifter">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <Field label="Företagsnamn" required>
              <Input name="legalName" required autoFocus />
            </Field>
            <Field
              label="Organisationsnummer"
              description="Ange med eller utan bindestreck. Bolaget får automatiskt aktieslag A med en röst per aktie."
              required
            >
              <Input name="registrationValue" required />
            </Field>
            <FormActions align="start">
              <Button type="submit" variant="primary" loading={loading}>
                Skapa bolag
              </Button>
              <Button type="button" onClick={() => navigate("/companies")} disabled={loading}>
                Avbryt
              </Button>
            </FormActions>
          </form>
        </Panel>
      </PageBody>
    </>
  );
}

export function CompanySettingsRoute() {
  const { companyId } = useParams();
  const { companies } = useApplicationData();
  const { isAdmin } = useApplicationAccess();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const company = companies.find(({ id }) => id === companyId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string>();

  if (!company) {
    return (
      <>
        <PageHeader title="Bolaget finns inte" />
        <PageBody width="prose">
          <Callout tone="critical">Bolaget kunde inte hittas.</Callout>
        </PageBody>
      </>
    );
  }

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Inställningar" meta={company.legalName} />
        <PageBody width="prose">
          <Callout tone="critical" title="Administratörsbehörighet krävs">
            Endast administratörer kan ändra bolagets inställningar.
          </Callout>
        </PageBody>
      </>
    );
  }

  const statusLabel = company.status === "ACTIVE" ? "aktivt bolag" : "utkast";

  async function confirmRemoval() {
    if (!company) return;
    setRemoving(true);
    setError(undefined);
    try {
      await removeCompany({ companyId: company.id });
      setConfirmOpen(false);
      navigate("/companies", { replace: true });
      revalidator.revalidate();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      <PageHeader title="Inställningar" meta={`${company.legalName} · ${statusLabel}`} />
      <PageBody width="form">
        <Panel title="Riskområde" description="Permanent borttagning av bolaget och aktieboken.">
          <div className="flex flex-col items-start gap-4">
            <Callout tone="critical" title="Permanent och oåterkallelig åtgärd">
              Detta är ett {statusLabel}. Bolaget, hela aktieboken, samtliga aktieägare, aktieslag
              och händelser tas bort permanent. Både aktiva bolag och utkast kan tas bort. Åtgärden
              kan inte ångras. Skapa en säkerhetskopia först.
            </Callout>
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              Ta bort bolaget permanent
            </Button>
          </div>
        </Panel>
      </PageBody>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Ta bort ${company.legalName}?`}
        description={`Bolaget är ett ${statusLabel}. Det och hela dess aktiebok tas bort permanent och kan inte återställas.`}
        confirmLabel="Ta bort bolaget permanent"
        tone="danger"
        loading={removing}
        onConfirm={confirmRemoval}
      >
        {error ? (
          <Callout tone="critical" title="Bolaget kunde inte tas bort">
            {error}
          </Callout>
        ) : (
          <p className="text-sm text-ink-muted">
            Säkerställ att en aktuell säkerhetskopia finns innan du fortsätter.
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
