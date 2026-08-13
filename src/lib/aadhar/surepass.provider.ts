import { AadhaarProvider, DigilockerInitInput, DigilockerSession, AadhaarDetails } from "./aadhar.interface";

const BASE_URL = "https://sandbox.surepass.app/api/v1";

const INITIALIZE_ENDPOINT = `${BASE_URL}/digilocker/initialize`;

const DOWNLOAD_AADHAAR_ENDPOINT = `${BASE_URL}/digilocker/download-aadhaar`;

export class SurepassAadhaarInstance implements AadhaarProvider {
    private token: string;

    constructor(token: string) {
        this.token = token;
    }

    async initializeDigilocker(input: DigilockerInitInput): Promise<DigilockerSession> {
        const res = await fetch(INITIALIZE_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.token}`,
            },
            body: JSON.stringify({
                data: {
                    signup_flow: true,
                    redirect_url: input.redirectUrl,
                    skip_main_screen: false,
                    prefill_options: input.prefill
                        ? {
                            full_name: input.prefill.fullName,
                            user_email: input.prefill.email,
                            mobile_number: input.prefill.phone,
                        }
                        : undefined,
                },
            }),
        });

        if (!res.ok)
            throw new Error("Aadhaar DigiLocker initialization failed - service error");

        const body = (await res.json()) as any;
        const result = body.data;

        if (!result?.client_id || !result?.url)
            throw new Error("Aadhaar DigiLocker initialization failed - service error");

        return {
            clientId: result.client_id,
            url: result.url,
            expirySeconds: result.expiry_seconds,
        };
    }

    async fetchAadhaarDetails(clientId: string): Promise<AadhaarDetails> {
        const res = await fetch(DOWNLOAD_AADHAAR_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.token}`,
            },
            body: JSON.stringify({ client_id: clientId }),
        });

        if (!res.ok)
            throw new Error("Aadhaar verification failed - DigiLocker data could not be retrieved");

        const body = (await res.json()) as any;
        const result = body.data;

        if (!result)
            throw new Error("Aadhaar verification failed - DigiLocker data could not be retrieved");

        const xml = result.aadhaar_xml_data ?? {};
        const meta = result.digilocker_metadata ?? {};

        return {
            aadhaarNumberMasked: xml.masked_aadhaar ?? "",
            fullName: xml.full_name ?? meta.name,
            dob: xml.dob ?? meta.dob,
            gender: xml.gender ?? meta.gender,
            address: xml.full_address,
            raw: result,
        };
    }
}