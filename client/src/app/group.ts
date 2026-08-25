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
}
