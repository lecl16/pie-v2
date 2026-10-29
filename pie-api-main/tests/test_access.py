"""Access-control tests of the API: who may call which route, from where.

They back the server-side results of the dissertation's validation (the
attacks A9, A11, A12, A14-A17 and the rejoin of R8), and run against an
in-memory SQLite database, without MySQL, Redis or the startup tasks:

    docker run --rm -v "$PWD":/app -w /app --env-file .env \
        -e PYTHONPATH=/app pie-api-main-app python -m unittest discover -s tests -v
"""

import unittest
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.websockets import WebSocketDisconnect

from app.api.main import app
from app.core.auth import create_access_token, get_teacher_or_admin_stream_user
from app.core.database import get_db
from app.core.tunnel import TUNNEL_IP_HEADER, device_tunnel_ip
from app.models.db.base import Base
from app.models.db.course import Course
from app.models.db.device import Device
from app.models.db.device_provisioning_secret import DeviceProvisioningSecret
from app.models.db.exam import Exam
from app.models.db.session import Session as ExamSession
from app.models.db.session_user import SessionUser
from app.models.db.user import User

COURSE, EXAM, SESSION, JOIN_CODE = "C1", 1, 1, "JOIN1"
DEVICE, OTHER_DEVICE = 5, 6
STUDENT, OTHER_STUDENT = 100, 200
DURATION = 3600


class AccessTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(engine)
        self.engine = engine
        self.Db = sessionmaker(bind=engine)
        db = self.Db()
        db.add_all([
            User(nmec=1, name="Teacher", email="teacher@ua.pt", password="x", role="teacher"),
            User(nmec=2, name="Admin", email="admin@ua.pt", password="x", role="admin"),
            User(nmec=STUDENT, name="Student", email="student@ua.pt", password="x", role="student"),
            User(nmec=OTHER_STUDENT, name="Other", email="other@ua.pt", password="x", role="student"),
            Course(id=COURSE, name="Course"),
            Device(id=DEVICE, name="device"),
            Device(id=OTHER_DEVICE, name="other device"),
        ])
        db.add(Exam(id=EXAM, name="Exam", course_id=COURSE))
        db.add(ExamSession(
            id=SESSION, join_code=JOIN_CODE, name="Session", course_id=COURSE, exam_id=EXAM,
            encryption_key="exam-key", duration=DURATION, is_started=False, is_ended=False,
        ))
        # The confirmed session tap: the student assigned to the device.
        db.add(DeviceProvisioningSecret(
            device_id=DEVICE, session_id=SESSION, secret="s" * 43, nmec=STUDENT,
            expires_at=datetime.utcnow() + timedelta(minutes=5), claimed_at=datetime.utcnow(),
        ))
        db.commit()
        db.close()

        def override_db():
            db = self.Db()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)
        self.teacher = {"Authorization": f"Bearer {create_access_token({'sub': 'teacher@ua.pt'})}"}

    def tearDown(self):
        app.dependency_overrides.clear()
        self.engine.dispose()

    # --- helpers ---

    def tunnel(self, device_id=DEVICE):
        return {TUNNEL_IP_HEADER: device_tunnel_ip(device_id)}

    def join(self, device_id=DEVICE):
        return self.client.post(
            "/session-users/join", json={"join_code": JOIN_CODE}, headers=self.tunnel(device_id)
        )

    def student(self, device_id=DEVICE):
        """The student's headers after a join: their token, from their device's tunnel."""
        response = self.join()
        self.assertEqual(response.status_code, 200, response.text)
        token = response.json()["access_token"]
        return {"Authorization": f"Bearer {token}", **self.tunnel(device_id)}

    def start_session(self, started_minutes_ago=10):
        db = self.Db()
        db.query(ExamSession).filter(ExamSession.id == SESSION).update({"is_started": True})
        db.query(SessionUser).filter(SessionUser.user_nmec == STUDENT).update(
            {"start_time": datetime.utcnow() - timedelta(minutes=started_minutes_ago)}
        )
        db.commit()
        db.close()

    def key(self, headers):
        return self.client.get(f"/course/{COURSE}/{EXAM}/{SESSION}/key", headers=headers)

    # --- the join (A8, A10) ---

    def test_join_only_through_a_device_tunnel(self):
        response = self.client.post("/session-users/join", json={"join_code": JOIN_CODE})
        self.assertEqual(response.status_code, 403)

    def test_join_takes_the_student_from_the_tap(self):
        response = self.join()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["user_nmec"], STUDENT)

    def test_join_refused_from_a_device_not_provisioned(self):
        self.assertEqual(self.join(OTHER_DEVICE).status_code, 403)

    # --- the student's token (A9) ---

    def test_token_refused_outside_its_tunnel(self):
        headers = self.student()
        self.start_session()
        self.assertEqual(self.key({"Authorization": headers["Authorization"]}).status_code, 401)
        moved = {**headers, **self.tunnel(OTHER_DEVICE)}
        self.assertEqual(self.key(moved).status_code, 401)

    # --- the exam's key (A16) and the rejoin (R8) ---

    def test_key_refused_before_the_start(self):
        self.assertEqual(self.key(self.student()).status_code, 403)

    def test_key_given_after_the_start(self):
        headers = self.student()
        self.start_session()
        response = self.key(headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["key"], "exam-key")

    def test_key_given_to_a_teacher_at_any_time(self):
        self.assertEqual(self.key(self.teacher).status_code, 200)

    def test_rejoin_after_the_start_resumes_with_the_time_left(self):
        self.student()
        self.start_session(started_minutes_ago=10)
        body = self.join().json()
        self.assertTrue(body["is_started"])
        self.assertAlmostEqual(body["remaining_seconds"], DURATION - 600, delta=5)

    # --- session routes (A14) ---

    def test_student_cannot_end_the_session(self):
        headers = self.student()
        self.start_session()
        response = self.client.post(f"/course/{COURSE}/{EXAM}/{SESSION}/end", headers=headers)
        self.assertEqual(response.status_code, 403)
        db = self.Db()
        self.assertFalse(db.get(ExamSession, SESSION).is_ended)
        db.close()

    def test_student_cannot_list_sessions(self):
        response = self.client.get(f"/course/{COURSE}/{EXAM}/sessions", headers=self.student())
        self.assertEqual(response.status_code, 403)

    # --- users (A15) ---

    def test_student_cannot_make_themself_admin(self):
        response = self.client.put(f"/users/{STUDENT}", json={"role": "admin"}, headers=self.student())
        self.assertEqual(response.status_code, 403)
        db = self.Db()
        self.assertEqual(db.get(User, STUDENT).role, "student")
        db.close()

    def test_teacher_cannot_edit_users(self):
        response = self.client.put(f"/users/{STUDENT}", json={"role": "admin"}, headers=self.teacher)
        self.assertEqual(response.status_code, 403)

    # --- activity logs (A11, A12) and the live stream (R5) ---

    def test_student_cannot_write_logs_for_another_student(self):
        response = self.client.post(
            f"/logs/session/{SESSION}/user/{OTHER_STUDENT}",
            json={"device_id": DEVICE, "level": "info", "category": "system", "message": "forged"},
            headers=self.student(),
        )
        self.assertEqual(response.status_code, 403)

    def test_student_cannot_read_logs(self):
        response = self.client.get(f"/logs/session/{SESSION}/user/{STUDENT}", headers=self.student())
        self.assertEqual(response.status_code, 403)

    def test_live_stream_reads_the_token_from_the_url(self):
        url = f"/logs/session/{SESSION}/user/{STUDENT}/stream"
        self.assertEqual(self.client.get(url).status_code, 401)
        token = self.student()["Authorization"].split()[1]
        response = self.client.get(f"{url}?token={token}", headers=self.tunnel())
        self.assertEqual(response.status_code, 403)

    def test_live_stream_accepts_a_teacher_token_in_the_url(self):
        # The stream itself needs Redis, so its access check is tried alone.
        probe = FastAPI()

        @probe.get("/probe", dependencies=[Depends(get_teacher_or_admin_stream_user)])
        def _probe():
            return {"ok": True}

        probe.dependency_overrides[get_db] = app.dependency_overrides[get_db]
        token = self.teacher["Authorization"].split()[1]
        self.assertEqual(TestClient(probe).get(f"/probe?token={token}").status_code, 200)

    # --- screen sharing (A17) ---

    def test_screen_view_refused_without_a_teacher_login(self):
        for query in ("", f"?token={self.student()['Authorization'].split()[1]}"):
            with self.assertRaises(WebSocketDisconnect) as closed:
                with self.client.websocket_connect(f"/screenshare/ws/monitor/{SESSION}{query}") as ws:
                    ws.receive_text()
            self.assertEqual(closed.exception.code, 1008)


if __name__ == "__main__":
    unittest.main()
