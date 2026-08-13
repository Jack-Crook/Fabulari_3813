import { Service, inject } from '@angular/core';    // Service = injectable decorator; inject() = grabs a dependency
import { HttpClient } from '@angular/common/http';  // lets this service make HTTP requests

@Service()           // marks this class as injectable app-wide, without needing to register it manually anywhere
export class Auth {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000';

  register(email: string, password: string) {       // send a POST request to the Express /register route with email + password as the JSON body
  return this.http.post(`${this.apiUrl}/register`, { email, password });
}
}

