import { Service, inject } from '@angular/core';    // Service = injectable decorator; inject() = grabs a dependency
import { HttpClient } from '@angular/common/http';  // lets this service make HTTP requests

// the shape the express /login route sends back, so the component gets real types instead of a plain object
export interface LoginResponse {
  message: string;
  email: string;
  role: string;
}

// what gets kept in localStorage once someone is logged in
export interface StoredUser {
  email: string;
  role: string;
}


@Service()           // marks this class as injectable app-wide, without needing to register it manually anywhere
export class Auth {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000';

  register(email: string, password: string) {       // send a POST request to the Express /register route with email + password as the JSON body
  return this.http.post(`${this.apiUrl}/register`, { email, password });
}
  login(email: string, password: string) {          // send a POST request to the Express /login route with email + password as the JSON body
    return this.http.post<LoginResponse>(`${this.apiUrl}/login`, { email, password });
}
  saveUser(email: string, role: string) {     // called after a successful login so the rest of the app knows who is signed in
    localStorage.setItem('user', JSON.stringify({ email, role }));   // localStorage only holds strings, so the object gets stringified first
  }

  getUser(): StoredUser | null {              // reads the logged in user back out, or null if nobody is logged in
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;      // getItem gives back null when the key isn't there, so only parse when there's something to parse
  }

  logout() {
    localStorage.removeItem('user');          // clearing the key is all "logging out" means for now, there's no server side session
  }

}


