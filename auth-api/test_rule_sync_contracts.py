import unittest

from models import Subscription, User
from schemas import FeatureAccessOut, SubscriptionOut, UserStatusResponse
from schemas_admin import AdminUserListItem


class RuleSyncContractTests(unittest.TestCase):
    def test_auth_models_default_plan_matches_trial_contract(self):
        self.assertEqual(User.__table__.c.plan.default.arg, "trial")
        self.assertEqual(Subscription.__table__.c.plan.default.arg, "trial")

    def test_auth_schemas_default_plan_matches_trial_contract(self):
        self.assertEqual(SubscriptionOut.model_fields["plan"].default, "trial")
        self.assertEqual(UserStatusResponse.model_fields["plan"].default, "trial")
        self.assertEqual(FeatureAccessOut.model_fields["required_plan"].default, "trial")

    def test_admin_user_defaults_match_trial_contract(self):
        self.assertEqual(AdminUserListItem.model_fields["plan"].default, "trial")
        self.assertEqual(AdminUserListItem.model_fields["membership_status"].default, "trial")
        self.assertEqual(AdminUserListItem.model_fields["membership_label"].default, "试用中")


if __name__ == "__main__":
    unittest.main()
