export interface DigilockerInitInput {
  redirectUrl?: string;
  prefill?: {
    fullName?: string;
    email?: string;
    phone?: string;
  };
}

export interface DigilockerSession {
  clientId: string;
  url: string;
  expirySeconds: number;
}

export interface AadhaarDetails {
  aadhaarNumberMasked: string;
  fullName?: string;
  dob?: string;
  gender?: string;
  address?: string;
  raw: unknown;
}

export interface AadhaarProvider {
  initializeDigilocker(input: DigilockerInitInput): Promise<DigilockerSession>;
  fetchAadhaarDetails(clientId: string): Promise<AadhaarDetails>;
}