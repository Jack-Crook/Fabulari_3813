import { Service, inject, signal, computed } from '@angular/core';    // Service = injectable decorator; inject() = grabs a dependency
import { HttpClient } from '@angular/common/http';  // lets this service make HTTP requests

// one account as the server sends it back. the password is never in here, because server.js strips it
// off every user it returns, so there's nothing to leak into the client.
export interface AppUser {
  email: string;
  role: string;
  username: string;
  dob: string;        // yyyy-mm-dd, empty when they haven't set one. the age limit check needs it
  bio: string;
  avatarUrl: string;  // /uploads/<uuid>.png on the api server, or '' when they haven't set a picture
  createdAt: string;
}

// the shape the express /login route sends back: a message plus the same fields as AppUser
export interface LoginResponse extends AppUser {
  message: string;
}

// what gets kept in localStorage once someone is logged in. deliberately smaller than AppUser,
// only what the navbar and the group pages need to decide what to show. everything else is
// fetched fresh, because localStorage goes stale the moment the profile is edited elsewhere.
export interface StoredUser {
  email: string;
  role: string;
  username: string;
  avatarUrl?: string;   // optional, so a session saved before profile pictures existed still reads fine
}

// the fields a user is allowed to change about themself. email isn't here, because the spec
// makes it the unique identifier for the account, and neither is role.
export interface ProfileChanges {
  username?: string;
  dob?: string;
  bio?: string;
  password?: string;
}


@Service()           // marks this class as injectable app-wide, without needing to register it manually anywhere
export class Auth {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000';

  // localStorage can't tell angular when it changes, so saveUser and logout bump this counter and
  // `session` below re-reads storage whenever it moves. that's what lets the navbar redraw the
  // moment the profile page changes the picture or the name, instead of on the next page load.
  private sessionVersion = signal(0);

  // the signed in user as a signal. localStorage is still where it lives, this only makes a
  // change to it something the template can react to.
  session = computed(() => {
    this.sessionVersion();
    return this.getUser();
  });

  // username and dob are optional at signup. the server falls back to the part before the @
  // when no username is given, so nobody ends up nameless.
  register(email: string, password: string, username?: string, dob?: string) {
    return this.http.post<{ message: string; email: string; role: string }>(
      `${this.apiUrl}/register`, { email, password, username, dob });
  }

  login(email: string, password: string) {          // send a POST request to the Express /login route with email + password as the JSON body
    return this.http.post<LoginResponse>(`${this.apiUrl}/login`, { email, password });
}

  getUsers() {                                // GET /users, every registered account. the super admin's members panel
    return this.http.get<AppUser[]>(`${this.apiUrl}/users`);
  }

  // GET /users/:email. the profile page uses this instead of reading localStorage, so it shows
  // what's actually stored rather than whatever was true at login.
  fetchUser(email: string) {
    return this.http.get<AppUser>(`${this.apiUrl}/users/${encodeURIComponent(email)}`);
  }

  // PUT /users/:email. only the fields in `changes` are sent, so leaving password out of the
  // object means "don't touch the password" rather than "set it to empty".
  updateProfile(email: string, changes: ProfileChanges) {
    // actorEmail says who is asking. the server refuses the edit unless it matches the account
    // in the url, so one signed in user can't PUT another user's password. same "the caller
    // tells the server who they are" pattern GroupService uses on its write methods.
    return this.http.put<AppUser>(`${this.apiUrl}/users/${encodeURIComponent(email)}`,
      { ...changes, actorEmail: this.email });
  }

  // POST /users/:email/avatar, a new profile picture. FormData because it's a file upload, the
  // same as a chat image. actorEmail goes BEFORE the file: multer reads the form top to bottom,
  // and the server's "only your own picture" check needs it in req.body by the time the file
  // has been written.
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

  // the server stores a relative path, so it keeps working if the api's address changes. this
  // turns it into something an <img> can load, the same as ChatService.imageSrc.
  avatarSrc(avatarUrl: string) {
    return `${this.apiUrl}${avatarUrl}`;
  }

  saveUser(user: StoredUser) {     // called after a successful login so the rest of the app knows who is signed in
    localStorage.setItem('user', JSON.stringify(user));   // localStorage only holds strings, so the object gets stringified first
    this.sessionVersion.update(v => v + 1);
  }

  getUser(): StoredUser | null {              // reads the logged in user back out, or null if nobody is logged in
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;      // getItem gives back null when the key isn't there, so only parse when there's something to parse
  }

  // used by the route guards and by every component that needs "who am I" as a plain string.
  // this is state, not security. the server doesn't verify it, it just stops the wrong pages
  // being rendered by someone typing a url.
  get email(): string {
    return this.getUser()?.email ?? '';
  }

  get isSuper(): boolean {
    return this.getUser()?.role === 'super';
  }

  logout() {
    localStorage.removeItem('user');          // clearing the key is all "logging out" means for now, there's no server side session
    this.sessionVersion.update(v => v + 1);
  }

}
