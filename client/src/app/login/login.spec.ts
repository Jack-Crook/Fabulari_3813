import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { Login } from './login';
import { Auth } from '../auth';
import { testProviders, signOut } from '../testing';

describe('Login', () => {
  let component: Login;
  let fixture: ComponentFixture<Login>;
  let mock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: testProviders(),
    }).compileComponents();

    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    mock = TestBed.inject(HttpTestingController);
    signOut();
    await fixture.whenStable();
  });

  afterEach(() => signOut());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('stores the signed in user after a successful login', () => {
    component.email = 'a@b.com';
    component.password = 'pw1234';
    component.onSubmit();

    mock.expectOne('http://localhost:3000/login').flush({
      message: 'Login successful', email: 'a@b.com', role: 'user',
      username: 'ab', dob: '', bio: '', createdAt: '',
    });

    // localStorage is what every other page reads to work out who is signed in. it's state,
    // not security — the server never checks it.
    expect(TestBed.inject(Auth).getUser()).toEqual({ email: 'a@b.com', role: 'user', username: 'ab' });
    expect(component.successmessage()).toBe('Logged in successfully.');
  });

  it('shows the server\'s message when the credentials are wrong', () => {
    component.onSubmit();

    // express sends its errors as { error: '...' }, and that body arrives on err.error
    mock.expectOne('http://localhost:3000/login')
      .flush({ error: 'Invalid email or password' }, { status: 401, statusText: 'Unauthorized' });

    expect(component.errormessage()).toBe('Invalid email or password');
    // the button unlocks again so they can retry, otherwise a wrong password would end the session
    expect(component.submitting()).toBe(false);
  });

  it('ignores a second submit while the first is still in flight', () => {
    component.onSubmit();
    component.onSubmit();   // a double click on the button

    // one request, not two. without the guard both would fire, and both would redirect.
    mock.expectOne('http://localhost:3000/login').flush({
      message: 'ok', email: 'a@b.com', role: 'user', username: 'ab', dob: '', bio: '', createdAt: '',
    });
  });
});
