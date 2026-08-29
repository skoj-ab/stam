function passesLuhn(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;

  const sum = [...digits].reduce((total, character, index) => {
    const product = Number(character) * (index % 2 === 0 ? 2 : 1);
    return total + Math.floor(product / 10) + (product % 10);
  }, 0);
  return sum % 10 === 0;
}

export function isValidSwedishPersonalNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!/^(?:\d{10}|\d{6}[-+]\d{4}|\d{12}|\d{8}-\d{4})$/.test(trimmed)) return false;
  return passesLuhn(trimmed.replace(/[-+]/g, "").slice(-10));
}

export function normalizeSwedishPersonalNumber(value: string): string | undefined {
  if (!isValidSwedishPersonalNumber(value)) return undefined;
  return value.trim().replace(/[-+]/g, "").slice(-10);
}

export function isValidSwedishOrganizationNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\d{6}-?\d{4}$/.test(trimmed)) return false;
  return passesLuhn(trimmed.replace("-", ""));
}

export function normalizeSwedishOrganizationNumber(value: string): string | undefined {
  if (!isValidSwedishOrganizationNumber(value)) return undefined;
  return value.trim().replace("-", "");
}

export function formatSwedishIdentifier(value: string): string {
  return /^\d{10}$/.test(value) ? `${value.slice(0, 6)}-${value.slice(6)}` : value;
}

export function formatCompanyRegistrationIdentifier(company: {
  registrationCountry: string;
  registrationScheme: string;
  registrationValue: string;
}): string {
  if (
    company.registrationCountry === "SE" &&
    company.registrationScheme === "ORGANISATIONSNUMMER"
  ) {
    return formatSwedishIdentifier(company.registrationValue);
  }
  return company.registrationValue;
}
