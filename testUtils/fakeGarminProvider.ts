// Stand-in for GarminProvider in main.ts tests (installed with vi.mock). Everything the plugin calls is
// scriptable and recorded; no network is involved.
import type { AuthState } from "../src/providers/garmin/auth-state";
import type { CredentialLoginOutcome } from "../src/providers/garmin/garmin-api";
import type { OAuth1Token, OAuth2Token } from "../src/providers/garmin/garmin-oauth";
import { FakeProvider } from "./fakeProvider";

export class FakeGarminProvider extends FakeProvider {
	static instances: FakeGarminProvider[] = [];
	static last(): FakeGarminProvider {
		return FakeGarminProvider.instances[FakeGarminProvider.instances.length - 1]!;
	}

	override readonly id = "garmin";
	oauth1: OAuth1Token | null = null;
	oauth2: OAuth2Token | null = null;
	authState: AuthState = "unknown";
	attemptAllowed = true;
	version = "";
	region = "international";
	closedLogin = 0;
	clearedSession = 0;
	diagnostics = "";
	loginDiagnostics = "login log";
	signinUrl = "https://sso.example/signin";
	credentialOutcome: CredentialLoginOutcome = { status: "ok" };
	mfaOutcome: CredentialLoginOutcome = { status: "ok" };
	ticketResult: boolean | Error = true;
	credentialCalls: [string, string][] = [];
	mfaCalls: string[] = [];
	ticketCalls: string[] = [];

	constructor() {
		super();
		FakeGarminProvider.instances.push(this);
	}

	override isSessionValid(): boolean {
		return this.oauth1 !== null;
	}
	setVersion(v: string): void {
		this.version = v;
	}
	setRegion(r: string): void {
		this.region = r;
	}
	setTokens(o1: OAuth1Token | null, o2: OAuth2Token | null): void {
		this.oauth1 = o1;
		this.oauth2 = o2;
	}
	getTokens(): { oauth1: OAuth1Token | null; oauth2: OAuth2Token | null } {
		return { oauth1: this.oauth1, oauth2: this.oauth2 };
	}
	getAuthState(): AuthState {
		return this.authState;
	}
	shouldAttemptSync(): boolean {
		return this.attemptAllowed;
	}
	closeActiveLogin(): void {
		this.closedLogin++;
	}
	async clearSession(): Promise<void> {
		this.clearedSession++;
		this.oauth1 = null;
		this.oauth2 = null;
	}
	getSyncDiagnostics(): string {
		return this.diagnostics;
	}
	getLoginDiagnostics(): string {
		return this.loginDiagnostics;
	}
	getSigninUrl(): string {
		return this.signinUrl;
	}
	async loginWithCredentials(email: string, password: string): Promise<CredentialLoginOutcome> {
		this.credentialCalls.push([email, password]);
		if (this.credentialOutcome.status === "ok") this.oauth1 = { oauth_token: "t", oauth_token_secret: "s" };
		return this.credentialOutcome;
	}
	async completeMfaLogin(code: string): Promise<CredentialLoginOutcome> {
		this.mfaCalls.push(code);
		return this.mfaOutcome;
	}
	async authenticateWithTicket(input: string): Promise<boolean> {
		this.ticketCalls.push(input);
		if (this.ticketResult instanceof Error) throw this.ticketResult;
		if (this.ticketResult) this.oauth1 = { oauth_token: "t", oauth_token_secret: "s" };
		return this.ticketResult;
	}
}
