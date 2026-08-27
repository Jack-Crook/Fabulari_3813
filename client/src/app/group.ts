import { Service, inject } from '@angular/core';    // Service = injectable decorator; inject() = grabs a dependency
import { HttpClient } from '@angular/common/http';  // lets this service make HTTP requests

// the shape the express /groups routes send back, matches one record in data/groups.json
export interface Group {
  id: string;
  name: string;
  description: string;
  ageLimit: number;
  theme: string;              // hex colour, the group picks it and it carries into its chat rooms
  adminEmails: string[];
  memberEmails: string[];
}

// one record from data/channels.json. a channel is a room inside a group
export interface Channel {
  id: string;
  groupId: string;
  name: string;
}

@Service()          // same as Auth, marks this class injectable app-wide
export class GroupService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000';

  getGroups() {                     // GET /groups, every group in the system
    return this.http.get<Group[]>(`${this.apiUrl}/groups`);
  }

  getChannels(groupId: string) {    // GET /channels?groupId=g1, just the rooms inside one group
    return this.http.get<Channel[]>(`${this.apiUrl}/channels`, { params: { groupId } });
  }

  // POST /groups. the server puts creatorEmail into both adminEmails and memberEmails, so
  // whoever fills in the form becomes that group's first admin, which is what the spec asks for.
  createGroup(name: string, description: string, ageLimit: number, theme: string, creatorEmail: string) {
    return this.http.post<Group>(`${this.apiUrl}/groups`, { name, description, ageLimit, theme, creatorEmail });
  }

  // POST /groups/:id/members, assigns an already registered user to an existing group
  joinGroup(groupId: string, email: string) {
    return this.http.post<Group>(`${this.apiUrl}/groups/${groupId}/members`, { email });
  }

  // DELETE /groups/:id/members/:email. this is the group level removal, the account itself
  // still exists. the server answers 409 if removing them would leave the group with no admin.
  // the email is encoded because it goes in the url rather than the body, and characters like
  // + and # would otherwise change what the path means.
  removeMember(groupId: string, email: string) {
    return this.http.delete<Group>(`${this.apiUrl}/groups/${groupId}/members/${encodeURIComponent(email)}`);
  }

  createChannel(groupId: string, name: string) {    // POST /channels, a new room inside a group
    return this.http.post<Channel>(`${this.apiUrl}/channels`, { groupId, name });
  }

  deleteChannel(channelId: string) {                // DELETE /channels/:id
    return this.http.delete<{ message: string }>(`${this.apiUrl}/channels/${channelId}`);
  }
}
