import { Service, inject, signal, computed } from '@angular/core';    // Service = injectable decorator; inject() = grabs a dependency
import { HttpClient } from '@angular/common/http';

// one account as the server sends it. never has a password, the server strips it.
export interface AppUser {
  email: string;
  role: string;
  username: string;
  dob: string;        // yyyy-mm-dd, '' if not set. used for age limits
  bio: string;
  avatarUrl: string;  // /uploads/<uuid>.png, or '' for no picture
  createdAt: string;
}

// what /login sends back
export interface LoginResponse extends AppUser {
  message: string;
}

// what's kept in localStorage. only what the navbar and guards need, the rest is fetched fresh.
export interface StoredUser {
  email: string;
  role: string;
  username: string;
  avatarUrl?: string;   // optional, older sessions don't have it
}

// the editable profile fields. no email (the identifier) and no role.
export interface ProfileChanges {
  username?: string;
  dob?: string;
  bio?: string;
  password?: string;
}


@Service()           // injectable app-wide
export class Auth {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000';

  // localStorage can't notify angular, so saveUser and logout bump this counter
  private sessionVersion = signal(0);

  // the signed in user as a signal, re-read whenever the counter changes. lets the navbar
  // update straight away when the name or picture changes.
  session = computed(() => {
    this.sessionVersion();
    return this.getUser();
  });

  // username and dob are optional, the server defaults the username to the part before the @
  register(email: string, password: string, username?: string, dob?: string) {
    return this.http.post<{ message: string; email: string; role: string }>(
      `${this.apiUrl}/register`, { email, password, username, dob });
  }

  login(email: string, password: string) {          // POST /login
    return this.http.post<LoginResponse>(`${this.apiUrl}/login`, { email, password });
}

  getUsers() {                                // GET /users, for the super admin's members panel
    return this.http.get<AppUser[]>(`${this.apiUrl}/users`);
  }

  // GET /users/:email. the profile page loads from here, not stale localStorage.
  fetchUser(email: string) {
    return this.http.get<AppUser>(`${this.apiUrl}/users/${encodeURIComponent(email)}`);
  }

  // PUT /users/:email. only the fields in `changes` are sent, so no password = unchanged.
  updateProfile(email: string, changes: ProfileChanges) {
    // actorEmail says who is asking. the server refuses unless it matches the url.
    return this.http.put<AppUser>(`${this.apiUrl}/users/${encodeURIComponent(email)}`,
      { ...changes, actorEmail: this.email });
  }

  // POST /users/:email/avatar. actorEmail goes BEFORE the file: multer reads the form in order
  // and the server's check needs it in req.body by then.
  uploadAvatar(file: File) {
    const form = new FormData();
    form.append('actorEmail', this.email);
    form.append('image', file);
    return this.http.post<AppUser>(`${this.apiUrl}/users/${encodeURIComponent(this.email)}/avatar`, form);
  }

  // DELETE /users/:email/avatar, back to the initial letter
  removeAvatar() {
    return this.http.delete<AppUser>(`${this.apiUrl}/users/${encodeURIComponent(this.email)}/avatar`,
      { params: { actorEmail: this.email } });
  }

  // the server stores a relative path, this makes it loadable by an <img>
  avatarSrc(avatarUrl: string) {
    return `${this.apiUrl}${avatarUrl}`;
  }

  saveUser(user: StoredUser) {     // after login
    localStorage.setItem('user', JSON.stringify(user));   // localStorage only holds strings
    this.sessionVersion.update(v => v + 1);
  }

  getUser(): StoredUser | null {              // the signed in user, or null
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  }

  // "who am I", for the guards and components. state, not security: the server doesn't verify it.
  get email(): string {
    return this.getUser()?.email ?? '';
  }

  get isSuper(): boolean {
    return this.getUser()?.role === 'super';
  }

  logout() {
    localStorage.removeItem('user');          // no server side session, so this is all logout is
    this.sessionVersion.update(v => v + 1);
  }

}
