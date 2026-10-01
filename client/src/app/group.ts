import { Service, inject } from '@angular/core';    // Service = injectable decorator; inject() = grabs a dependency
import { HttpClient } from '@angular/common/http';

// one group document
export interface Group {
  _id: string;                // mongo id, as a 24 character hex string
  name: string;
  description: string;
  ageLimit: number;
  theme: string;              // hex colour, carries into the group's chat rooms
  adminEmails: string[];
  memberEmails: string[];
  bannedEmails: string[];     // group level bans, the accounts still exist
}

// a channel is a room inside a group
export interface Channel {
  _id: string;
  groupId: string;
  name: string;
}

// a member as GET /groups/:id/members sends them. only what chat needs, profiles are private.
export interface GroupMember {
  email: string;
  username: string;
  avatarUrl: string;    // '' for no picture
}

// PATCH /groups/:id's reply: the saved group, plus anyone a raised age limit removed
export interface GroupEditResponse {
  group: Group;
  booted: string[];
}

// what a group admin can edit without a request
export interface GroupChanges {
  name?: string;
  description?: string;
  ageLimit?: number;
  theme?: string;
}

@Service()
export class GroupService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000';

  getGroups() {                     // GET /groups
    return this.http.get<Group[]>(`${this.apiUrl}/groups`);
  }

  getChannels(groupId: string) {    // GET /channels?groupId=, one group's rooms
    return this.http.get<Channel[]>(`${this.apiUrl}/channels`, { params: { groupId } });
  }

  // GET /groups/:id/members, names and pictures for the chat room
  getMembers(groupId: string) {
    return this.http.get<GroupMember[]>(`${this.apiUrl}/groups/${groupId}/members`);
  }

  // PATCH /groups/:id. actorEmail lets the server check the caller is an admin.
  updateGroup(groupId: string, changes: GroupChanges, actorEmail: string) {
    return this.http.patch<GroupEditResponse>(`${this.apiUrl}/groups/${groupId}`, { ...changes, actorEmail });
  }

  // POST /groups/:id/members, join. you can only join yourself, and the server answers 403
  // if you're under the age limit or banned from the group.
  joinGroup(groupId: string, email: string) {
    return this.http.post<Group>(`${this.apiUrl}/groups/${groupId}/members`, { email, actorEmail: email });
  }

  // DELETE /groups/:id/members/:email, leave or remove. 409 if it would leave no admin.
  // the email is encoded since + and # would change the url's meaning.
  removeMember(groupId: string, email: string, actorEmail: string) {
    return this.http.delete<Group>(
      `${this.apiUrl}/groups/${groupId}/members/${encodeURIComponent(email)}`,
      { params: { actorEmail } });
  }

  // POST /groups/:id/bans. removes them and stops them rejoining. can be lifted, unlike a system ban.
  banFromGroup(groupId: string, email: string, reason: string, actorEmail: string) {
    return this.http.post<Group>(`${this.apiUrl}/groups/${groupId}/bans`, { email, reason, actorEmail });
  }

  liftGroupBan(groupId: string, email: string, actorEmail: string) {
    return this.http.delete<Group>(
      `${this.apiUrl}/groups/${groupId}/bans/${encodeURIComponent(email)}`,
      { params: { actorEmail } });
  }

  // POST /groups/:id/admins, promote a member
  promoteAdmin(groupId: string, email: string, actorEmail: string) {
    return this.http.post<Group>(`${this.apiUrl}/groups/${groupId}/admins`, { email, actorEmail });
  }

  // DELETE /groups/:id/admins/:email, demote or step down. refused for the last admin.
  demoteAdmin(groupId: string, email: string, actorEmail: string) {
    return this.http.delete<Group>(
      `${this.apiUrl}/groups/${groupId}/admins/${encodeURIComponent(email)}`,
      { params: { actorEmail } });
  }

  createChannel(groupId: string, name: string, actorEmail: string) {    // POST /channels
    return this.http.post<Channel>(`${this.apiUrl}/channels`, { groupId, name, actorEmail });
  }

  renameChannel(channelId: string, name: string, actorEmail: string) {  // PATCH /channels/:id
    return this.http.patch<Channel>(`${this.apiUrl}/channels/${channelId}`, { name, actorEmail });
  }

  deleteChannel(channelId: string, actorEmail: string) {                // DELETE /channels/:id
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/channels/${channelId}`, { params: { actorEmail } });
  }
}
