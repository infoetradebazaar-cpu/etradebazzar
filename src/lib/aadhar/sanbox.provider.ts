import { AadhaarProvider, DigilockerInitInput, DigilockerSession, AadhaarDetails } from "./aadhar.interface";

/** Deterministic fake DigiLocker provider for local/dev/test - never contacts Surepass or DigiLocker. */
export class SandboxAadhaarInstance implements AadhaarProvider {
    constructor(
        private apiKey: string,
        private apiSecret: string,
    ) { }

    async initializeDigilocker(_input: DigilockerInitInput): Promise<DigilockerSession> {
        const clientId = `sandbox_digilocker_${Date.now()}`;
        return {
            clientId,
            url: `https://sandbox.local/digilocker-mock?client_id=${clientId}&apiKey=${this.apiKey ? "set" : "unset"}`,
            expirySeconds: 600,
        };
    }

    async fetchAadhaarDetails(clientId: string): Promise<AadhaarDetails> {
        return {
            aadhaarNumberMasked: "XXXXXXXX0000",
            fullName: "SANDBOX TEST USER",
            dob: "1990-01-01",
            gender: "M",
            address: "Sandbox Address, Test City, Test State, 000000",
            raw: { sandbox: true, clientId, apiSecret: this.apiSecret ? "set" : "unset" },
        };
    }
}